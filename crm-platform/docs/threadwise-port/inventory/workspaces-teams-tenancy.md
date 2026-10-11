---
domain: workspaces-teams-tenancy
code: WSP
title: Workspaces, Teams, Tenancy, Impersonation and Admin User Management
threadwise_version: '1.7.0'
sources_read: 78
---

# Workspaces, Teams, Tenancy, Impersonation and Admin User Management

## Overview

A **workspace** is Reference's tenant: one business (or one agency client). Every customer-facing table carries a
`workspace_id`, and almost every query is scoped through `users.current_workspace_id` (the workspace the signed-in user is
"standing in"). Contacts, devices, conversations, broadcasts, flows, billing and the plan itself belong to exactly one
workspace. Membership is **many-to-many**: one `users` row can belong to several workspaces through the
`workspace_user` pivot, holding a _different workspace role in each_ (`owner`, `admin`, `manager`, `agent`, `viewer`).
This is the single most important structural difference from the target platform, where a user row lives inside exactly
one organization (see Port notes).

Who uses this domain:

- **Workspace owner / admin** - creates workspaces (onboarding step 2 or the in-app "Create workspace" page), edits the
  workspace profile, invites teammates, assigns roles, resets teammate passwords, deletes the workspace, exports data.
- **Any member** - switches between the workspaces they belong to; opens a workspace by its slug URL.
- **Platform super-admin / platform support** - the `/admin` console: list and create workspaces on behalf of customers,
  edit plan/owner/limits, suspend/reactivate, flag, soft-delete, verify a white-label custom domain, "log in as owner"
  (impersonation with a mandatory reason and audit trail), and manage every user account on the platform (create, edit,
  suspend, force-logout, password-reset email, trash/restore, CSV bulk import).
- **End customers of a white-label tenant** - a workspace with a verified `custom_domain` gets its own hostname; every
  request on that host is locked to that workspace.
- **Background** - `workspaces:wipe-expired` destroys data of workspaces whose plan lapsed beyond the plan retention
  window; an auth-event listener gives every platform admin a private workspace.

End-to-end flow: register (AUTH domain) -> step 2 creates the first workspace on the default plan/trial and attaches the
user as `owner` -> the user lands with `current_workspace_id` set -> invites teammates (temp password or existing
account) -> members switch workspaces via the header switcher -> platform staff can impersonate the workspace for support
or suspend it. Plan tiers change this domain through numeric limits resolved on the workspace (`workspaces_per_owner_limit`,
`user_seat_limit`, `device_limit`, ...) via `Workspace::effectiveLimit()`; admins can override any limit per workspace
(`plan_overrides` JSON) and platform-admin-owned workspaces are unlimited.

Connections to other domains: PLAN (packages, trial/expiry, checkout stamping `trial_ends_at`/`plan_ends_at`), RBAC
(platform Spatie roles/permissions and the workspace permission map used by policies), AUTH (registration steps 1 and 3,
login, password reset, `account/suspended` gate, 2FA), NOTIF (audit log writer, in-app notifications, workspace
notification prefs), TIB1/TIB2 (Team Inbox consumes teams, members, business hours, agent status), WADEV/WABA (send-engine
resolution consumes `WorkspaceEngine`), MOB (`api/app/workspaces*` endpoints reuse `WorkspaceProvisioner` and the same
membership rules), CHK/STORE (custom-domain storefront resolution uses `workspaces.custom_domain`), CORE (installer creates
the first workspace), ASHELL (admin console chrome and IP allow-list).

## Feature index

| Id         | Feature                                                                                   | Status      | Priority | Effort | Depends on                         |
| ---------- | ----------------------------------------------------------------------------------------- | ----------- | -------- | ------ | ---------------------------------- |
| TW-WSP-001 | Onboarding workspace creation (register step 2)                                           | implemented | P0       | M      | TW-WSP-004, TW-WSP-010             |
| TW-WSP-002 | WorkspaceProvisioner (one-call account bootstrap for mobile/social signup)                | implemented | P0       | S      | TW-WSP-001                         |
| TW-WSP-003 | Create additional workspace (in-app)                                                      | implemented | P0       | M      | TW-WSP-004, TW-WSP-005, TW-WSP-020 |
| TW-WSP-004 | Workspace creation hooks: slug uniqueness, starter tags, timezone canonicalisation, audit | implemented | P0       | S      | -                                  |
| TW-WSP-005 | Workspace switcher and switch endpoint                                                    | implemented | P0       | M      | TW-WSP-012                         |
| TW-WSP-006 | Workspace slug deep link (`/{slug}`)                                                      | implemented | P2       | S      | TW-WSP-005                         |
| TW-WSP-007 | Workspace general settings (name, timezone, currency)                                     | implemented | P1       | S      | TW-WSP-020                         |
| TW-WSP-008 | Workspace data export (CSV)                                                               | implemented | P2       | S      | TW-WSP-020                         |
| TW-WSP-009 | Delete workspace (owner self-service)                                                     | implemented | P1       | M      | TW-WSP-020                         |
| TW-WSP-010 | Workspace entitlement resolution (plan, trial, expiry, add-ons, overrides, admin bypass)  | implemented | P0       | L      | TW-WSP-031                         |
| TW-WSP-011 | Send-engine resolution (`WorkspaceEngine`)                                                | implemented | P0       | L      | TW-WSP-010                         |
| TW-WSP-012 | Request tenant context resolution (`current_workspace_id` semantics)                      | implemented | P0       | M      | -                                  |
| TW-WSP-013 | White-label custom-domain tenancy (`ResolveTenantDomain`)                                 | implemented | P1       | M      | TW-WSP-030, TW-WSP-012             |
| TW-WSP-014 | Suspended-workspace guard and suspended screen (`EnsureWorkspaceMembership`)              | dead-code   | P1       | S      | TW-WSP-027, TW-WSP-028             |
| TW-WSP-015 | Members page (list, filters, statuses)                                                    | implemented | P0       | M      | TW-WSP-020                         |
| TW-WSP-016 | Invite member (existing or new account, temp password, seat limit)                        | implemented | P0       | M      | TW-WSP-020, TW-WSP-010             |
| TW-WSP-017 | Change member role                                                                        | implemented | P0       | S      | TW-WSP-020                         |
| TW-WSP-018 | Remove member                                                                             | implemented | P0       | S      | TW-WSP-020, TW-WSP-022             |
| TW-WSP-019 | Reset member password (one-time temp password)                                            | implemented | P1       | S      | TW-WSP-020                         |
| TW-WSP-020 | Workspace role model, permission matrix and role gates                                    | implemented | P0       | L      | -                                  |
| TW-WSP-021 | Pending invitation activation on login                                                    | implemented | P1       | S      | TW-WSP-016                         |
| TW-WSP-022 | Teams within a workspace (CRUD)                                                           | implemented | P1       | M      | TW-WSP-020                         |
| TW-WSP-023 | Admin: workspace list                                                                     | implemented | P0       | M      | TW-WSP-010                         |
| TW-WSP-024 | Admin: create workspace on behalf of a customer                                           | implemented | P0       | M      | TW-WSP-004, TW-WSP-030             |
| TW-WSP-025 | Admin: workspace detail dashboard                                                         | implemented | P1       | M      | TW-WSP-010                         |
| TW-WSP-026 | Admin: edit workspace (plan grant, owner, slug, caps)                                     | implemented | P0       | M      | TW-WSP-010                         |
| TW-WSP-027 | Admin: suspend / reactivate toggle                                                        | partial     | P0       | S      | TW-WSP-014                         |
| TW-WSP-028 | Admin: suspend / unsuspend with frozen flag and trust-and-safety flags                    | partial     | P1       | S      | TW-WSP-014                         |
| TW-WSP-029 | Admin: move workspace to trash                                                            | partial     | P1       | S      | -                                  |
| TW-WSP-030 | Admin: custom-domain DNS verification                                                     | implemented | P1       | S      | TW-WSP-013                         |
| TW-WSP-031 | Admin: per-workspace plan limit overrides                                                 | partial     | P2       | S      | TW-WSP-010                         |
| TW-WSP-032 | Impersonation: start session                                                              | implemented | P0       | M      | TW-WSP-012                         |
| TW-WSP-033 | Impersonation: banner, scoping, effective Owner grant and stop                            | implemented | P0       | M      | TW-WSP-032                         |
| TW-WSP-034 | Private admin workspace auto-provisioning                                                 | implemented | P1       | S      | -                                  |
| TW-WSP-035 | Data-retention wipe (`workspaces:wipe-expired`)                                           | partial     | P2       | M      | TW-WSP-010                         |
| TW-WSP-036 | Admin-provisioning fields stored but not enforced (caps, pre-seed, skip-onboarding)       | docs-only   | P2       | S      | TW-WSP-024                         |
| TW-WSP-037 | Admin: users list                                                                         | implemented | P0       | M      | -                                  |
| TW-WSP-038 | Admin: create user                                                                        | implemented | P0       | M      | TW-WSP-046                         |
| TW-WSP-039 | Admin: edit user                                                                          | implemented | P0       | M      | TW-WSP-046                         |
| TW-WSP-040 | Admin: suspend / reactivate user and suspended-account screen                             | implemented | P0       | S      | TW-WSP-046                         |
| TW-WSP-041 | Admin: send password-reset email (rate limited)                                           | implemented | P1       | S      | -                                  |
| TW-WSP-042 | Admin: force logout (revoke all sessions)                                                 | implemented | P1       | S      | -                                  |
| TW-WSP-043 | Admin: move user to trash                                                                 | implemented | P1       | S      | -                                  |
| TW-WSP-044 | Admin: users trash, restore, force delete, empty trash                                    | partial     | P1       | M      | TW-WSP-043                         |
| TW-WSP-045 | Admin: bulk CSV user import and template                                                  | implemented | P2       | M      | TW-WSP-046                         |
| TW-WSP-046 | Privileged-role escalation guard (Super Admin gate)                                       | implemented | P0       | S      | -                                  |
| TW-WSP-047 | User account entity (`users`) and platform role column                                    | implemented | P0       | M      | -                                  |

## Features

### TW-WSP-001 — Onboarding workspace creation (register step 2)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WSP-004, TW-WSP-010
- **Summary:** Right after signup step 1 (account creation, owned by AUTH) the user lands on "Step 2 of 3 / Workspace", names their first workspace and is attached as its `owner`. The workspace lands on the admin-chosen default plan and, when that plan is free, a trial window starts. The user is then sent to step 3 (plan picker).
- **Actors & access:** any authenticated user (route middleware `Authenticate` only; no workspace-role gate, so it also works for a brand-new account with zero workspaces). `EnsureUserActive` explicitly allow-lists `register.workspace` and `register.workspace.store` so an unverified account is not bounced to email verification mid-flow. No plan gate on the first workspace (the per-owner cap is only checked by the in-app create page, TW-WSP-003). Workspace scope: creates one.
- **UX & screens:** `resources/views/auth/register/step2.blade.php` (chooses chrome by the `auth.variant` system setting 1-5; variant 1 = two-column showcase) including `auth/register/_step2_form.blade.php`. Fields: **Workspace name** (required, max 120, prefilled with "<email-local-part title-cased>'s workspace"), **Industry** select (ecommerce, saas, agency, education, healthcare, finance, travel, hospitality, other), **Team size** select (1, 2-5, 6-20, 21-100, 100+), **Timezone** (searchable Tom Select over all IANA ids, defaults to system setting `default_timezone`, else app timezone, else Asia/Kolkata), and a **Mobile number** field shown ONLY when the account has no mobile yet (social-login accounts). If the user already has workspaces an "Already have ..." list with a "Skip / continue to plan" link is shown. Validation errors render as a list above the form. Submit button "Continue / pick a plan". JS: `resources/js/charts/auth-register-step2.js` hydrates the timezone list from `Intl.supportedValuesOf` (fallback short list) and upgrades to Tom Select.
- **Endpoints:**

  | Endpoint                | Route name               | Action                           | Middleware   | Request                                                                 | Response                                                                |
  | ----------------------- | ------------------------ | -------------------------------- | ------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
  | GET register/workspace  | register.workspace       | AuthController@showWorkspaceStep | Authenticate | -                                                                       | step 2 view with `existing` workspaces, `suggested_name`, `need_mobile` |
  | POST register/workspace | register.workspace.store | AuthController@storeWorkspace    | Authenticate | name, industry, size_range, timezone, brand_color, mobile, country_code | redirect to `register.plan` with status flash                           |

- **Data:** writes `workspaces` (owner_user_id, name, slug, industry, size_range, timezone, plan, status=1, last_active_at, optional brand_color, trial_ends_at, billing_cycle), `workspace_user` (role `owner`, `joined_at` now), `users.mobile`/`country_code` (only when supplied), `users.current_workspace_id` (via `switchWorkspace`), `notifications` (one "Workspace created" row), `audit_logs` (`workspace.created` via observer, `workspace.entered` via switch).
- **Rules & edge cases:**
  1. Validation: `name` required string max 120; `industry` max 64; `size_range` max 32; `timezone` max 64; `brand_color` max 16; `mobile` required only if the account has no mobile, otherwise nullable, regex `^[0-9()+\-\s]{6,20}$`, max 20; `country_code` required-if-mobile-missing, max 8. Custom messages: "A mobile number is required." / "Enter a valid mobile number." The stored mobile has all whitespace stripped; existing mobile/country_code are never wiped when the field is omitted.
  2. Plan resolution order: system setting `registration_default_plan_id` (a package `plan_id` slug, must be active `status=1`) -> first active package flagged `is_default` -> first active free package ordered by `sort_order` (free = `free=true` OR `plan_amount=0` and not custom-quote) -> literal `'starter'`. The workspace stores the package **slug** (`plan_id`) in `workspaces.plan`.
  3. Trial: only if the resolved package is free (`isFreePlan()`), `registration_trial_days` (default 14) > 0 sets `trial_ends_at = now + N days` and `billing_cycle = 'trial'`. Paid default plans never get a trial. `trial_days = 0` means the free plan has no expiry (no trial bar).
  4. `brand_color` is only written if the user actually picked one; omitting the key lets the column default (`#075E54`) apply. It must never be written as NULL on legacy schemas (that once broke signup). `workspace_brand_color()` treats null or `#075E54` as "follow the theme".
  5. Slug: `Workspace::generateSlug(name)` (see TW-WSP-004). Because two concurrent signups can pass the pre-check and collide on the unique index, the insert is retried up to 5 times with `slug-<random6 lowercase>` when the violated constraint is `workspaces_slug_unique` (any other unique violation is re-thrown), then a last-ditch `workspace-<userId>-<random6>`.
  6. Membership: attach as `owner` with `joined_at = now` (no `invited_at`). Then `switchWorkspace()` makes it current and bumps `last_active_at` (TW-WSP-005).
  7. In-app notification "Workspace created" (category system, severity success, action_url /dashboard) to the user, subject to the workspace's notification prefs.
  8. Multi-workspace: a user who already has workspaces can hit this route again and simply create another one without the per-owner cap (QUIRK: the cap is enforced only on `workspaces.store`, so this onboarding route is a bypass of `workspaces_per_owner_limit`; a Manager/Agent could use it too because no role gate applies).
- **Async & events:** model `created` hooks fire (starter tags, audit row, `LogsNotifications` notification record). No queue work. No mail.
- **External systems:** none.
- **Settings:** `registration_default_plan_id` (default ''), `registration_trial_days` (default 14), `default_timezone`, `auth.variant` (default 1); all admin `SystemSetting` rows.
- **Acceptance criteria:**
  - Given a logged-in user with no workspace, When they POST `register/workspace` with only `name`, Then a workspace is created with a unique slug, plan = default plan slug, the user is a `workspace_user` `owner` with `joined_at` set, `users.current_workspace_id` points to it, and the browser is redirected to `register/plan`.
  - Given the default plan is free and `registration_trial_days` = 14, When the workspace is created, Then `trial_ends_at` is now+14 days and `billing_cycle` = `trial`; Given the default plan is paid, Then `trial_ends_at` stays null.
  - Given an account without a mobile number (social signup), When step 2 is submitted without mobile, Then validation fails with "A mobile number is required."; Given the account already has a mobile, Then the mobile field is not shown and not required.
  - Given two simultaneous requests creating a workspace with the same name, When both insert, Then neither returns a 500 and both get distinct slugs.
  - Given workspace creation succeeds, Then exactly 6 starter tags exist for it (TW-WSP-004) and one "Workspace created" notification exists for the user.
- **Source refs:** `app/Http/Controllers/AuthController.php` (showWorkspaceStep, storeWorkspace), `app/Models/Workspace.php`, `resources/views/auth/register/step2.blade.php`, `resources/views/auth/register/_step2_form.blade.php`, `resources/js/charts/auth-register-step2.js`, `app/Http/Middleware/EnsureUserActive.php`, `routes/web.php` (register block), `Documentation/pages/getting-started/workspaces.html`.
- **Port notes:** target already has `organizations` (tenant) and `users` scoped to one org; signup should create the org row plus the first admin user in one transaction and seed the starter tags via the outbox/domain event, not a model hook. `plan` column: store a plan FK/enum, not a slug-or-id string (Reference stores slug at signup but numeric id at checkout/admin edit; see Open questions). Keep the "skippable mobile capture for social signups" rule with AUTH. Do not port the onboarding cap bypass.

### TW-WSP-002 — WorkspaceProvisioner (one-call account bootstrap for mobile/social signup)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S
- **Depends on:** TW-WSP-001
- **Summary:** A service that gives a brand-new user an immediately usable workspace in one call: same plan/trial resolution as web onboarding but with an auto-generated name. Used by the mobile app register/social endpoints and by the mobile "create workspace" endpoint.
- **Actors & access:** internal service (`app/Services/WorkspaceProvisioner.php`); no route of its own. Called from `Api\App\AuthController` (register and social login when the user has no workspace) and `Api\App\WorkspaceController@store` (MOB domain).
- **UX & screens:** none (server-side).
- **Endpoints:** none owned here. Consumers: `POST api/app/workspaces` and the app register/social flows (MOB domain).
- **Data:** writes `workspaces`, `workspace_user`, `users.current_workspace_id` via `switchWorkspace`.
- **Rules & edge cases:**
  1. Name = optional argument, else `"<user name>'s Workspace"`, else `"My Workspace"`; slug via `generateSlug`.
  2. Plan resolution and trial rules are identical to TW-WSP-001 rules 2-3 (registration_default_plan_id -> is_default -> first free -> 'starter'; trial only for free plans and `registration_trial_days` > 0).
  3. Fixed defaults: timezone `Asia/Kolkata` (ignores the `default_timezone` setting, unlike web onboarding), `brand_color = '#075E54'`, status true, `last_active_at = now`.
  4. Attaches the user as `owner` with `joined_at = now`, then calls `switchWorkspace()` which persists `current_workspace_id` (the mobile create endpoint has to undo that so the web session is not yanked; see MOB).
  5. No plan-limit check inside the service; the mobile endpoint checks `workspaces_per_owner_limit` before calling it (>0 and count of owned workspaces >= limit -> 403 "You have reached the workspace limit for your plan.").
- **Async & events:** same model hooks as TW-WSP-004.
- **External systems:** none.
- **Settings:** `registration_default_plan_id`, `registration_trial_days`.
- **Acceptance criteria:**
  - Given a user with no workspace, When `provision($user)` runs, Then a workspace named "<name>'s Workspace" exists with the user as `owner`, current workspace set, plan per the resolution order.
  - Given the default plan is free with trial days 14, Then `trial_ends_at` is now+14d; Given it is paid, Then no trial.
  - Given `provision($user, 'Acme')` is called with an explicit name, Then the workspace name/slug is derived from `Acme` (the mobile controller instead renames after provisioning).
- **Source refs:** `app/Services/WorkspaceProvisioner.php`, `app/Http/Controllers/Api/App/WorkspaceController.php` (caller), `app/Http/Controllers/Api/App/AuthController.php` (callers at register and social login).
- **Port notes:** implement as a domain service `WorkspaceProvisioningService.provision(user, name?)` shared by web and mobile signup so both get identical plan/trial defaults. Fix the hard-coded timezone to read the same setting as web onboarding.

### TW-WSP-003 — Create additional workspace (in-app)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WSP-004, TW-WSP-005, TW-WSP-020
- **Summary:** A signed-in owner/admin opens "Create workspace" from the header switcher or user menu, fills a short form and gets a second, separate workspace on the Starter plan. The page shows their existing workspaces and blocks creation with an upgrade prompt when the plan's per-owner workspace cap is reached.
- **Actors & access:** middleware `Authenticate` + `workspace.role:admin` (owner or admin of the CURRENT workspace, or a platform admin who bypasses workspace-role gates). Managers, agents and viewers are redirected to `/team-inbox` (agent/viewer) or get 403 (manager). Plan gate: `workspaces_per_owner_limit` via `PlanLimitGuard::check` against the current workspace's effective limit; null/0/negative = unlimited; platform admins (Spatie Super Admin/Admin or legacy role `admin`/`A`) bypass. The header hides every "Create new workspace" link when the user cannot create (limit reached, not owner/admin, or on a tenant domain).
- **UX & screens:** `resources/views/user/workspaces/create.blade.php` (page key `user-workspaces-create`, JS `auth-register-step2.js`). Left card: heading "Set up a workspace", fields **Workspace name** (required, maxlength 120, placeholder "e.g. Bloomly Marketing"), **Mobile number** (country code input + tel input, both required; prefilled from the user), **Industry** and **Team size** (same option lists as TW-WSP-001), **Timezone** (Tom Select, default Asia/Kolkata), Cancel and "Create workspace". If `limitReached` the form is replaced by a coral "Workspace limit reached" box ("Your current plan doesn't include another workspace...") with a "View plans" button (`/plans`) - this also applies to direct URL access. A flashed `session('error')` (e.g. the plan-limit exception message) and validation errors render above the form. Right rail: "Your workspaces" list - each row is a POST form to the switch endpoint showing a coloured 2-letter tile, name, slug, and a CURRENT pill for the active one; below a "Sealed by design" tip.
- **Endpoints:**

  | Endpoint              | Route name        | Action                      | Middleware                              | Request                                                    | Response                                                                               |
  | --------------------- | ----------------- | --------------------------- | --------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
  | GET workspaces/create | workspaces.create | WorkspacesController@create | Authenticate, EnsureWorkspaceRole:admin | -                                                          | view with `existing`, `suggested_name`='' , `limitReached`                             |
  | POST workspaces       | workspaces.store  | WorkspacesController@store  | Authenticate, EnsureWorkspaceRole:admin | name, industry, size_range, timezone, mobile, country_code | redirect to `user.dashboard` with status flash; on plan limit: back with `error` flash |

- **Data:** reads `users`, `workspaces` (owned count), package limits; writes `users.mobile/country_code`, `workspaces`, `workspace_user`, `users.current_workspace_id`, `notifications`, `audit_logs`.
- **Rules & edge cases:**
  1. Validation: `name` required max 120; `industry` max 64; `size_range` max 32; `timezone` max 64; `mobile` REQUIRED, max 20, regex `^[0-9()+\-\s]{6,20}$`; `country_code` REQUIRED max 8. Messages: "A mobile number is required." / "Enter a valid mobile number."
  2. QUIRK: the user's `mobile`/`country_code` are updated BEFORE the plan-limit check, so a request that then fails on the limit still overwrites the stored mobile.
  3. The cap compares `Workspace::where(owner_user_id = user)->count()` (soft-deleted excluded) to `effectiveLimit('workspaces_per_owner_limit')` of the CURRENT workspace (not the owner's best plan unless `billing_plan_scope = account`).
  4. New workspace: plan literally `'starter'` (NOT the admin-configured default plan used at signup), `status` true, `brand_color` null (null = follow theme), `last_active_at` now, timezone default `Asia/Kolkata`, no trial window (`trial_ends_at` null), billing_cycle column default `monthly`.
  5. Owner pivot `role=owner`, `joined_at=now`; `switchWorkspace()` makes it current (audit `workspace.entered`, `from` = previous id).
  6. Notification "Workspace created" (system/success, action /dashboard).
  7. `User::canCreateWorkspace()` drives the UI: admins always true; no current workspace true; limit null/<=0 true; lookup error true (fail open); else owned-count < limit.
  8. Redirect on success is `user.dashboard` with flash "Workspace \"<name>\" is ready."
- **Async & events:** model hooks (starter tags, audit `workspace.created`, notification record).
- **External systems:** none.
- **Settings:** plan limit `workspaces_per_owner_limit` (package column, per-workspace override possible), `billing_plan_scope` (workspace|account).
- **Acceptance criteria:**
  - Given an owner under their cap, When they submit a valid name and mobile, Then a second workspace exists on plan `starter`, they are its owner, and they are redirected to the dashboard with "Workspace \"X\" is ready."
  - Given an owner whose effective `workspaces_per_owner_limit` equals their owned count, When they open `/workspaces/create`, Then the upgrade prompt replaces the form; When they POST anyway, Then they are sent back with the plan-limit message and no workspace is created.
  - Given a user whose role in the current workspace is agent, When they open `/workspaces/create`, Then they are redirected to `/team-inbox` with a warning "Your role (agent) doesn't have access to that page."
  - Given a platform admin, When they create workspaces past any limit, Then no limit error is raised.
- **Source refs:** `app/Http/Controllers/WorkspacesController.php`, `app/Models/User.php` (canCreateWorkspace), `app/Services/PlanLimitGuard.php`, `app/Exceptions/PlanLimitReachedException.php`, `resources/views/user/workspaces/create.blade.php`, `resources/views/components/user/header.blade.php`, `routes/web.php`, `Documentation/pages/getting-started/workspaces.html`.
- **Port notes:** in the target this becomes "create organization under an existing account" only if we adopt multi-org accounts (see TW-WSP-047 port notes) - otherwise it is an admin/agency feature. If kept, enforce the cap against the account owner's plan in one place. Fix: run the limit check before mutating the user, and align the plan with the default-plan setting.

### TW-WSP-004 — Workspace creation hooks: slug uniqueness, starter tags, timezone canonicalisation, audit

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S
- **Depends on:** -
- **Summary:** Behavior baked into the `Workspace` model that every creation path (onboarding, in-app, admin, mobile, installer, admin auto-provision) inherits: a globally unique URL slug, six starter tags, canonical timezones, and automatic audit/notification records.
- **Actors & access:** internal (model events/accessors); no route.
- **UX & screens:** none directly; slug shows in the switcher rows and on the Settings > General "Workspace URL" (read-only) field; starter tags appear in the contacts tag picker.
- **Endpoints:** none.
- **Data:** `workspaces.slug` (unique index `workspaces_slug_unique`, varchar 255), `tags` rows (workspace_id, name, slug, color), `audit_logs`, `notifications`.
- **Rules & edge cases:**
  1. `generateSlug(base)`: `Str::slug(base)` or `'workspace'` if empty; while a workspace has that slug (the pre-check uses the default scope, so soft-deleted workspaces are NOT seen and can still collide on the DB unique index), append `-2`, `-3`, ... The slug is generated from the NAME only at creation; renames do not change it except in the admin edit path (TW-WSP-026).
  2. On `created`, seed exactly six tags via `firstOrCreate(workspace_id + name)`: New Lead `#2E7D32`, Interested `#F9A825`, Customer `#075E54`, VIP `#6A1B9A`, Follow Up `#1565C0`, Not Interested `#9E9E9E`; each with `slug = Str::slug(name)`. Wrapped in try/catch: a failure is logged as a warning and NEVER blocks workspace creation.
  3. Timezone: the attribute is normalised BOTH on read and write through `safe_timezone()` - a table of legacy aliases (Asia/Calcutta -> Asia/Kolkata, Asia/Rangoon -> Asia/Yangon, Europe/Kiev -> Europe/Kyiv, America/Buenos_Aires -> America/Argentina/Buenos_Aires, etc.) is mapped to canonical ids; anything not in PHP's canonical identifier list falls back to the app timezone (else UTC). Null/empty passes through unchanged so callers' own fallbacks still work.
  4. `AuditableObserver` is attached to `Workspace` (and `User`, `Package`, `Coupon`, `CreditPackage`, `Announcement`, `Order`, `Device`): every create/update/delete/restore writes `audit_logs` (`workspace.created`, `workspace.updated` with a compact changes map - values longer than 500 chars are replaced by "<N chars>" - `workspace.deleted`, `workspace.restored`). Updates with only `updated_at` changed are skipped.
  5. `LogsNotifications` trait on `Workspace` records a notification on created/updated/deleted via `NotificationHelper::record` (NOTIF domain owns the rendering and preference muting).
  6. `Workspace::$fillable` is the whitelist for mass assignment (owner, name, slug, plan, timezone, locale, engines, branding, notification_prefs, business_hours, plan_overrides, caps, admin fields ...); `data_wiped_at` is set only with `forceFill`.
- **Async & events:** synchronous model events only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a workspace named "Acme" exists, When another workspace named "Acme" is created, Then its slug is `acme-2`; a third yields `acme-3`.
  - Given any new workspace, Then it has exactly the six starter tags with the colours above; Given the tag seed throws, Then the workspace is still created and a warning is logged.
  - Given a workspace saved with timezone `Asia/Calcutta`, Then reading `timezone` returns `Asia/Kolkata`; Given an unknown timezone string, Then it reads back as the app default.
  - Given a workspace is created, Then an `audit_logs` row `workspace.created` exists with layer `workspace`.
- **Source refs:** `app/Models/Workspace.php` (generateSlug, STARTER_TAGS, booted, get/setTimezoneAttribute), `app/Support/fc_helpers.php` (safe_timezone), `app/Observers/AuditableObserver.php`, `app/Providers/AppServiceProvider.php` (observer wiring), `app/Models/Concerns/LogsNotifications.php`.
- **Port notes:** slug uniqueness must be enforced by a unique index plus retry, not a pre-check. Implement starter-tag seeding as an outbox consumer of `workspace.created` (idempotent on (org_id, name)). Store IANA canonical timezone ids only and validate on write with `Intl`/tz database.

### TW-WSP-005 — Workspace switcher and switch endpoint

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WSP-012
- **Summary:** A header dropdown lists every workspace the user belongs to (most recently active first) and lets them jump into another one; the whole app re-scopes to it. Switching is deliberately allowed even when the current workspace's trial has expired.
- **Actors & access:** any authenticated member. Route middleware `Authenticate`. Blocked on a white-label tenant domain. Allowed while a free trial is expired (`EnsureTrialActive` allow-lists any route name matching `*workspaces*`).
- **UX & screens:** header component `resources/views/components/user/header.blade.php` (desktop dropdown, shown at lg+ only; a copy lives in the mobile hamburger pane) and `components/user/sidebar-rail.blade.php` (sidebar layout). Button shows a 2-letter tile tinted with the workspace's `brand_color` (via `workspace_brand_color`, null/`#075E54` follows theme), the workspace name with an owner-possessive prefix stripped ("Bohecil's workspace" shows as "Workspace"; full name in tooltip and dropdown), and a chevron. Dropdown "Your workspaces": one POST form per workspace (tile, name, slug in mono, checkmark on current), then "Create new workspace" only when `canCreateWorkspace` (plan cap AND owner/admin AND not tenant domain). Not rendered when the user has no current workspace or is on a tenant domain.
- **Endpoints:**

  | Endpoint                    | Route name        | Action                         | Middleware   | Request             | Response                                                     |
  | --------------------------- | ----------------- | ------------------------------ | ------------ | ------------------- | ------------------------------------------------------------ |
  | POST workspaces/{id}/switch | workspaces.switch | AuthController@switchWorkspace | Authenticate | path `id` (numeric) | redirect back with `status` "Switched to <name>." or `error` |

- **Data:** reads `workspace_user`; writes `users.current_workspace_id`, `workspaces.last_active_at`, `audit_logs` (`workspace.entered`).
- **Rules & edge cases:**
  1. On a tenant domain (TW-WSP-013) the switch returns back with error "Workspace switching is disabled on this domain." without doing anything.
  2. Membership is verified via the `workspace_user` pivot (pending invitees with `joined_at` NULL count as members here). If not a member: back with error "You are not a member of that workspace." and nothing changes. (QUIRK: pending-invite rows are switchable; the mobile API requires `joined_at NOT NULL`.)
  3. On success: `users.current_workspace_id = id`, `workspaces.last_active_at = now` (drives the list ordering "most recently active first"), and an audit row `workspace.entered` with payload `{from: previousId}` - skipped when re-entering the same workspace so login-time fallbacks do not spam the log.
  4. The `User::current_workspace` accessor falls back to the user's first workspace when `current_workspace_id` is null or points at a missing/soft-deleted workspace.
  5. Per-workspace roles: the same person can be owner in one workspace and agent in another; nav and gates re-evaluate on the next request.
  6. Switcher list ordering: `last_active_at DESC`; soft-deleted workspaces never appear (default scope).
- **Async & events:** audit row only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a user in workspaces A and B, When they POST `/workspaces/B/switch`, Then `current_workspace_id = B`, B's `last_active_at` is updated, an audit `workspace.entered {from: A}` exists and they are redirected back with "Switched to B."
  - Given a user who is not a member of workspace C, When they POST `/workspaces/C/switch`, Then their current workspace is unchanged and they see "You are not a member of that workspace."
  - Given the current workspace's free trial is expired, When the user switches to another workspace, Then it succeeds (no 402 redirect to plans).
  - Given a request on a verified custom domain, When switch is posted, Then it is refused with the disabled message.
- **Source refs:** `app/Http/Controllers/AuthController.php` (switchWorkspace), `app/Models/User.php` (switchWorkspace, getCurrentWorkspaceAttribute), `resources/views/components/user/header.blade.php`, `resources/views/components/user/sidebar-rail.blade.php`, `app/Http/Middleware/EnsureTrialActive.php`, `Documentation/pages/getting-started/workspaces.html`.
- **Port notes:** with one-org-per-user (target), "switching" only exists if we add an account-to-many-orgs membership model; otherwise drop the endpoint and keep audit "org.entered" for impersonation only. If added: session/JWT carries the active org id, never a persisted column mutated by GET/POST (Reference's persisted `current_workspace_id` is shared by web and mobile and caused cross-surface hijacks that needed in-memory overrides).

### TW-WSP-006 — Workspace slug deep link (`/{slug}`)

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S
- **Depends on:** TW-WSP-005
- **Summary:** The "Workspace URL" (`<host>/<slug>`) opens the dashboard of that workspace for its members: it switches the signed-in user into that workspace and redirects to the dashboard.
- **Actors & access:** route middleware group `web` only (no `auth` middleware; the closure checks login itself). Registered dead last, after every other route file, so it only matches paths nothing else claims. Constraint `wsSlug` = `[A-Za-z0-9][A-Za-z0-9-]{1,60}`.
- **UX & screens:** none (redirect). Slug is shown read-only on Settings > General as `<host>/<slug>`.
- **Endpoints:**

  | Endpoint     | Route name          | Action                      | Middleware | Request   | Response                                               |
  | ------------ | ------------------- | --------------------------- | ---------- | --------- | ------------------------------------------------------ |
  | GET {wsSlug} | workspace.slug.open | Closure (bootstrap/app.php) | web        | path slug | 404 / redirect to login / redirect to `user.dashboard` |

- **Data:** reads `workspaces.slug`, `workspace_user`; writes `users.current_workspace_id`.
- **Rules & edge cases:**
  1. Unknown slug -> 404. Guest -> `redirect()->guest(route('login'))` so login returns them here.
  2. Membership = workspace owner_user_id equals the user OR a `workspace_user` row exists (pending or joined). Non-member -> 404 (not 403, to avoid leaking slug existence).
  3. CSRF-safe: the GET mutates state, so it only switches when `Sec-Fetch-Dest` is absent (legacy browsers) or equals `document`; any other value (img/iframe/fetch) -> 404.
  4. The switch here is a raw `forceFill(current_workspace_id)->save()`, NOT `User::switchWorkspace()`: no `last_active_at` bump and no `workspace.entered` audit row (QUIRK, inconsistent with TW-WSP-005).
  5. Because it is a single-segment catch-all, any 1-61 char alphanumeric path not otherwise routed becomes a slug lookup (404 for unknown), including paths like `/foo`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a logged-in member of workspace `acme`, When they GET `/acme` as a top-level navigation, Then `current_workspace_id` becomes that workspace and they are redirected to the dashboard.
  - Given a logged-in non-member, When they GET `/acme`, Then the response is 404.
  - Given a hidden `<img src="/acme">` request from another site (Sec-Fetch-Dest: image), Then the response is 404 and nothing is switched.
  - Given a guest, When they GET `/acme`, Then they are redirected to login and returned to `/acme` afterwards.
- **Source refs:** `bootstrap/app.php` (closure at the end of `then:`), `resources/views/user/settings/index.blade.php` (Workspace URL field).
- **Port notes:** implement as a Next.js route `/w/[slug]` (avoid a root catch-all) that resolves membership and sets the active org in the session; keep the top-level-navigation check as a `Sec-Fetch-Dest`/POST-only rule.

### TW-WSP-007 — Workspace general settings (name, timezone, currency)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** TW-WSP-020
- **Summary:** On Settings > General the workspace owner renames the workspace and sets its default timezone (used by scheduled sends, business hours, SLA timers) and currency (used on checkout, invoices and wallet display). The slug is shown but not editable.
- **Actors & access:** route `Authenticate`; the controller silently ignores non-owners (compares `workspaces.owner_user_id` to the user - workspace `owner` role holders who are not `owner_user_id` are treated as non-owners). Inputs are rendered disabled for non-owners with the note "Only the workspace owner can change timezone, currency, or workspace name."
- **UX & screens:** `resources/views/user/settings/index.blade.php` General tab card "Workspace": **Workspace name** (max 191), **Workspace URL** (read-only `<host>/<slug>` with hint "URL slug isn't editable here - contact support to change."), **Default timezone** select (all zones; hint "All scheduled sends, business-hours checks, and SLA timers run in this zone."), **Currency** select (`code - name (symbol)` from the `currencies` table; hint "Used on plan checkout, invoices, and wallet display."). Saves via a normal form POST, then redirects back with flash `settings_status` "Settings saved."; for non-owners "Only the workspace owner can edit these."
- **Endpoints:**

  | Endpoint      | Route name           | Action                             | Middleware   | Request                            | Response                                        |
  | ------------- | -------------------- | ---------------------------------- | ------------ | ---------------------------------- | ----------------------------------------------- |
  | POST settings | user.settings.update | UserPagesController@settingsUpdate | Authenticate | workspace_name, timezone, currency | redirect `user.settings` with `settings_status` |

  (GET `settings` = `user.settings`, the tabbed page, is a shared settings shell rendered by `UserPagesController@settings` and belongs to the settings/shell domains; only the workspace card is described here.)

- **Data:** writes `workspaces.name`, `.timezone`, `.currency`; reads `currencies`.
- **Rules & edge cases:**
  1. Validation: `workspace_name` nullable string max 191; `timezone` nullable string max 64 and must be a valid PHP timezone (`timezone` rule); `currency` nullable string max 10 and must exist in `currencies.code`. Blank values are ignored (never clears a field); currency is uppercased.
  2. Only non-empty values are applied in one `update()`; the slug is never touched.
  3. `FormatSettings::flushCache()` runs after the save so money formatting reflects the new currency immediately.
  4. If the user has no current workspace: back with flash "No workspace."
  5. `Workspace::timezone` write path canonicalises aliases (TW-WSP-004).
- **Async & events:** audit `workspace.updated` observer row; notification hook.
- **External systems:** none.
- **Settings:** none (this is the setting).
- **Acceptance criteria:**
  - Given the workspace owner, When they submit a new name, timezone `Europe/London` and currency `GBP`, Then `workspaces` reflects them and a success flash "Settings saved." is shown.
  - Given a member who is not `owner_user_id`, When they POST the form, Then nothing changes and they see "Only the workspace owner can edit these."
  - Given an invalid timezone or unknown currency code, Then validation fails and nothing is saved.
- **Source refs:** `app/Http/Controllers/UserPagesController.php` (settingsUpdate, settings), `resources/views/user/settings/index.blade.php`, `routes/web.php`.
- **Port notes:** authorise with a `workspace.settings` permission rather than the `owner_user_id` equality (Admin role already has `workspace.settings` in Reference's matrix but the settings controller ignores it - decide and document). Persist name/timezone/currency on `organizations` (currency likely under `settings` jsonb).

### TW-WSP-008 — Workspace data export (CSV)

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S
- **Depends on:** TW-WSP-020
- **Summary:** Settings > Data lets the owner download workspace contacts, conversations or messages as streamed CSV files (each link generates a fresh export).
- **Actors & access:** `Authenticate`; helper `ownerWorkspaceOrFail` requires the current workspace to exist (404 "No workspace.") and `owner_user_id == user` (403 "Owner only.").
- **UX & screens:** `user/settings/index.blade.php` Data tab: three cards (Contacts N records, Conversations N threads, Messages N messages, each "· CSV") linking to the export URL.
- **Endpoints:**

  | Endpoint                   | Route name           | Action                            | Middleware   | Request                                     | Response                                                                                          |
  | -------------------------- | -------------------- | --------------------------------- | ------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
  | GET settings/export/{type} | user.settings.export | SettingsTabsController@exportData | Authenticate | `type` in contacts, conversations, messages | streamed `text/csv` attachment `<type>.csv`; unknown type: back with error "Unknown export type." |

- **Data:** reads `contacts` (by users who are members of the workspace via the pivot, NOT by workspace_id), `conversations` (workspace_id), `inbox_messages` (via the workspace's conversation ids).
- **Rules & edge cases:**
  1. contacts.csv columns: id, name, mobile, email, status, created_at (ISO-8601). Selection is `Contact::whereIn(user_id, all workspace_user member ids)` - contacts owned by former members are dropped and contacts of a user who is a member of two workspaces appear in both exports (QUIRK: legacy user-scoped contacts).
  2. conversations.csv: id, channel, status, last_message_at, created_at.
  3. messages.csv: id, conversation_id, direction, body truncated to 500 chars, created_at; read from `inbox_messages`.
  4. Streaming with cursor; no row limit, no async job, no audit row.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the owner, When they GET `/settings/export/contacts`, Then a CSV with header `id,name,mobile,email,status,created_at` downloads.
  - Given a non-owner member, When they GET any export, Then they get 403 "Owner only."
  - Given an unknown type, Then they are redirected back with "Unknown export type."
- **Source refs:** `app/Http/Controllers/SettingsTabsController.php` (exportData, stream* generators, ownerWorkspaceOrFail), `resources/views/user/settings/index.blade.php`.
- **Port notes:** run as a BullMQ export job writing to object storage with a signed URL for large workspaces; scope contacts by `org_id` (not by user). Gate with an explicit `workspace.export` permission and audit each export.

### TW-WSP-009 — Delete workspace (owner self-service)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M
- **Depends on:** TW-WSP-020
- **Summary:** The owner can permanently delete their workspace from Settings > Data by typing the workspace name and their password. Technically it is a soft-delete of the `workspaces` row.
- **Actors & access:** `Authenticate`; requires current workspace and `owner_user_id == user` (403 "Owner only." otherwise). Non-owners see "Only the workspace owner can delete the workspace."
- **UX & screens:** `user/settings/index.blade.php` Data tab "Delete workspace" danger card: **Type the workspace name** (`confirm_name`, required), **Confirm with password** (`current_password`, required), coral button "Delete workspace permanently"; a browser `confirm()` ("Type the workspace name to confirm. This is irreversible.") precedes submit. Errors render inline under each field.
- **Endpoints:**

  | Endpoint                  | Route name                      | Action                                  | Middleware   | Request                        | Response                                                                  |
  | ------------------------- | ------------------------------- | --------------------------------------- | ------------ | ------------------------------ | ------------------------------------------------------------------------- |
  | DELETE settings/workspace | user.settings.workspace.destroy | SettingsTabsController@destroyWorkspace | Authenticate | confirm_name, current_password | redirect `/account` with success "Workspace deleted." or back with errors |

- **Data:** soft-deletes `workspaces` (sets `deleted_at`); writes a security audit row (`SecurityAuditLogger` action `workspace_deleted`, severity info, payload workspace id + name) and the observer's `workspace.deleted` audit row.
- **Rules & edge cases:**
  1. Both fields required strings. Wrong password -> errors `current_password`: "Wrong password." Name mismatch (trimmed compare, case-sensitive) -> `confirm_name`: "Workspace name does not match."
  2. Only the row is soft-deleted: members, contacts, devices, conversations, flows etc. are NOT removed, and pending scheduled jobs are not cancelled (QUIRK: the UI copy claims "Permanently delete this workspace, all conversations, automations, and billing history"; no cascade exists). There is no restore endpoint for workspaces (see TW-WSP-029).
  3. After deletion the deleting user's `current_workspace_id` still points at the deleted id; the `current_workspace` accessor falls back to their first remaining workspace, or none (then onboarding step 2).
  4. Other members' `workspace_user` rows remain but the workspace vanishes from their switchers (soft-delete scope on the relation).
  5. No block when it is the user's last workspace and no check for an active paid subscription (subscription cancellation is not triggered here).
- **Async & events:** audit rows only.
- **External systems:** none (gateway subscriptions are not cancelled).
- **Settings:** none.
- **Acceptance criteria:**
  - Given the owner, When they submit the correct name and password, Then the workspace is soft-deleted, an audit `workspace_deleted` row exists and they land on `/account` with "Workspace deleted."
  - Given a wrong password, Then nothing is deleted and "Wrong password." shows on the password field.
  - Given a non-owner admin, When they DELETE the endpoint, Then 403 "Owner only."
  - Given the workspace is deleted, Then it no longer appears in any member's switcher and admin lists (default scope).
- **Source refs:** `app/Http/Controllers/SettingsTabsController.php` (destroyWorkspace), `app/Support/SecurityAuditLogger.php`, `resources/views/user/settings/index.blade.php`, `app/Models/Workspace.php` (SoftDeletes).
- **Port notes:** implement as org offboarding: soft-delete + schedule a purge job honoring retention, cancel subscriptions and revoke integration credentials via outbox events; require re-auth (password or SSO step-up). Make the destructive scope explicit in the UI.

### TW-WSP-010 — Workspace entitlement resolution (plan, trial, expiry, add-ons, overrides, admin bypass)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L
- **Depends on:** TW-WSP-031
- **Summary:** The `Workspace` model is the single place that answers "what is this workspace allowed to do right now": which package it is on, whether it is on a free trial, whether the trial or paid plan has lapsed (lapsed paid plans silently drop to the free package), and the effective value of every limit or feature flag after per-workspace overrides and purchased add-ons.
- **Actors & access:** internal model API used by `PlanLimitGuard`, `EnforcePlanFeature`, `EnsureTrialActive`, billing, admin lists and mobile summaries. Owned by WSP because the data lives on `workspaces`; PLAN owns package/checkout rules.
- **UX & screens:** none directly. Surfaces: trial bar, plan lock screens (PLAN), admin detail "effective limits" and plan-usage bars (TW-WSP-025).
- **Endpoints:** none.
- **Data:** reads `workspaces.plan` (slug OR numeric package id), `trial_ends_at`, `plan_ends_at`, `billing_cycle`, `plan_overrides` (JSON `{limit_key: int|-1}`), `owner_user_id`; reads `packages` (`free`, `plan_id`, `plan_amount`, `data_retention_days`, limit and feature columns), `workspace_addons` (active + unexpired) -> `packages` of type addon, `system_settings.billing_plan_scope`.
- **Rules & edge cases:**
  1. `package()`: if `planExpired()` (plan_ends_at set and in the past) return the FREE package (first `free=true` by `sort_order`, else `plan_id='starter'`) - paid features lock until renewal. Else resolve by `packages.plan_id = workspaces.plan` first, then by numeric `id` if the value is numeric (the column is written as slug at signup and as numeric id by checkout and the admin editor). Null/empty plan -> no package. Cached per request keyed by plan value.
  2. `billingPackage()` is scope-aware: `billing_plan_scope='workspace'` (default) = `package()`; `'account'` = the owner's best plan across every workspace they own (highest `plan_amount` non-free package wins, else this workspace's own) so a paid plan on one workspace unlocks all of the owner's workspaces without a second trial.
  3. `effectiveLimit(key, fallback)`: (a) a key present in `plan_overrides` wins outright (even `0` or `-1`); (b) if the workspace owner is a platform admin (`isAdmin()`), booleans return true and numeric caps `-1` (unlimited) - strings pass through; (c) otherwise base = billing package column or the fallback; (d) active add-ons merge: booleans flip ON if any active add-on `grantsFeature(key)`; integers stack (sum of the base plus each add-on's explicit delta; any `-1` anywhere = `-1`; blank add-on limits grant nothing).
  4. Limit consumers treat `null`, `0` and negative as unlimited (`PlanLimitGuard`): a limit of `0` does NOT mean "none allowed".
  5. `onFreePlan()` = billing package is free or no package; `onTrial()` = free AND `trial_ends_at` not null; `trialExpired()` = onTrial AND `trial_ends_at` in the past; `planIsActive()` = not planExpired AND not trialExpired (drives whether the free monthly message allowance applies vs wallet overflow billing - see WALLET).
  6. Admin-set plan edits reset windows (TW-WSP-026); checkout resets `trial_ends_at` and stamps `plan_ends_at` (PLAN).
  7. `billsToPlatform()` returns `bill_to_platform_credit` (BSP reseller mode: platform credit is billed and the client's wallet is charged per message; default meta_direct).
  8. Other model behaviors that live on the workspace: `isSuspended()` (any uncleared flag of `frozen|tos_violation|fraud`), `suppressesOurAutoReply()` (`meta_agent_enabled` and mode `meta_agent_only|meta_agent_then_handoff`) and `inboundInboxStatus()` (`closed` for `meta_agent_only`, else `open`), `wantsNotification(event, channel)` with the `NOTIFICATION_EVENTS` catalog and `DEFAULT_NOTIFICATION_CHANNELS` (default in-app on, email/slack off except device_disconnected, wallet_low_balance, payment_failed, sla_breached, campaign_failed, webhook_delivery_failed, integration_disconnected, weekly_summary), `isOutsideBusinessHours(at)` over `business_hours` JSON (days mon..sun each `{enabled, from HH:MM, to HH:MM}` default Mon-Fri 09:00-18:00, plus `outside_action`, `outside_template_id`; null config = always open), `RESIDENCY_ALLOWED_SLUGS` (any / eu_only: deepl, libretranslate / local: libretranslate).
- **Async & events:** none (pure functions with static per-request caches keyed by workspace id).
- **External systems:** none.
- **Settings:** `billing_plan_scope` (workspace|account, default workspace), package columns, `plan_overrides`.
- **Acceptance criteria:**
  - Given a workspace on a paid plan whose `plan_ends_at` is yesterday, Then `package()` returns the free package and feature/limit checks use it.
  - Given `plan_overrides = {device_limit: 5}` and the package has `device_limit = 1`, Then `effectiveLimit('device_limit')` = 5; Given the owner is a platform admin, Then numeric caps return -1 unless the key is overridden.
  - Given an active add-on granting +2 `device_limit` on a base plan of 3, Then the effective limit is 5; Given any component is -1, Then -1.
  - Given `billing_plan_scope='account'` and the owner's other workspace is on a paid plan, Then this free workspace resolves that paid package.
  - Given a free plan with `trial_ends_at` in the past, Then `trialExpired()` and not `planIsActive()`.
- **Source refs:** `app/Models/Workspace.php`, `app/Models/WorkspaceAddon.php`, `app/Services/PlanLimitGuard.php`, `app/Http/Middleware/EnsureTrialActive.php`, `app/Http/Controllers/AdminPagesController.php` (PLAN_LIMIT_COLUMNS, PLAN_FEATURE_TOGGLES).
- **Port notes:** implement as an `EntitlementsService.resolve(orgId)` with memoised result and a cache key that includes an `entitlements_version` bumped on plan change/add-on purchase/override save (mirrors the existing `roles_version` pattern on `organizations`). Store plan as FK, `plan_overrides` as jsonb, add-ons in their own table (ADD domain). Decide explicitly whether limit `0` means unlimited or zero and document it in contracts; Reference treats 0 as unlimited in guards.

### TW-WSP-011 — Send-engine resolution (`WorkspaceEngine`)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L
- **Depends on:** TW-WSP-010
- **Summary:** One service answers "which channel engine does this workspace send through, and which concrete senders (paired numbers, Cloud API configs, bots, pages, mailboxes) are valid right now". Pickers, dashboards, campaigns, the inbox composer and flows all use it so a workspace switched from the Unofficial API to WABA never shows or sends via wrong-engine senders.
- **Actors & access:** internal service; consumers span WADEV, WABA, BCAST, CAMP, TIB1, FLB/FLR, channel domains, MOB.
- **UX & screens:** none; feeds "sender" dropdowns (badge descriptor: Meta/W, Twilio/T, Unofficial API/U, Instagram/I, Facebook/F, Telegram/T, LINE/L, WeChat/W, Viber/V, SMS/S, Email/E).
- **Endpoints:** none.
- **Data:** reads `wa_provider_configs` (workspace_id, provider in waba/twilio/sms/meta_ads, is_primary, status, connected_at, display_label, phone_number), `devices` (Unofficial API), `workspace_ig_accounts`, `facebook_pages`, `telegram_bots`, `line_channels`, `wechat_channels`, `viber_channels`, `workspace_email_accounts`, `workspaces.enabled_engines` (JSON array subset) and `default_engine`; `system_settings` (`allowed_send_methods` array default `['baileys']`, `default_send_method`, `facebook_enabled`, `telegram_enabled`, `line_enabled`, `wechat_enabled`, `viber_enabled`, `sms_enabled`, `email_enabled`).
- **Rules & edge cases:**
  1. Engine ids: `waba`, `baileys`, `twilio`, plus non-WhatsApp side channels `instagram`, `facebook`, `telegram`, `line`, `wechat`, `viber`, `sms`, `email`. Side channels are NEVER part of `allowed_send_methods`/`enginesFor()`/`availableFor()`; they appear in `senders()` only when a caller lists them in `$engines` and their feature switch and connected rows exist (email also needs plan feature `access_email`).
  2. `for(ws)` (the DEFAULT engine): (a) the workspace's `is_primary` provider row restricted to admin-allowed providers and excluding `meta_ads`; (b) else the most recently connected allowed provider row; (c) else platform default (`default_send_method`, fallback `baileys`). No workspace id -> platform default. Cached per request; `flush()` clears caches.
  3. `enginesFor(ws)`: connected provider rows (+ `baileys` if the workspace owns any device, or if it has no connected rows and orphan NULL-workspace devices exist) intersected with allowed methods and with `enabled_engines` when non-empty; default engine first; never empty (falls back to default).
  4. `availableFor(ws)`: allowed methods (minus meta_ads) intersected with `enabled_engines`, default first - what a workspace MAY connect, versus `enginesFor` = what is connected.
  5. `senders(ws, engines?, dedupePreferWaba)`: emits normalised rows `{key, engine, id, phone, label, descriptor, is_default}`; `key` = `<engine>:<row id>` (for Instagram the Instaflow account id, for Facebook the FacebookPage row id NOT the Meta page id). Baileys senders are devices with `status='connected'` (phone = digits of country_code+phone_number). Dedupe mode ranks waba < twilio < sms < baileys and keeps one row per phone number. Result sorted default-engine first.
  6. `parseSenderKey(ws, key)`: `engine:id` with known engine and positive id, or a bare numeric id which resolves to the default engine; anything else null. `senderForKey` re-lists senders including the parsed engine.
  7. Legacy orphan devices: `devices.workspace_id IS NULL` rows are visible to the pairing user only. `orphanPairerUserId()` returns 0 while a platform admin is impersonating (session key `impersonation_session_id`) so the admin's own orphan devices never leak into a customer's pickers. `ownsSender()` mirrors exactly what `senders()` lists (orphan fallback only for `Device`, never for `WaProviderConfig`, never while impersonating) so list rule and authorisation rule cannot drift.
  8. Labels for connect UI: `allowedEngineLabels()` = WABA / Unofficial API / Twilio filtered to admin-enabled; `allowedEnginesSentence()` builds "A, B or C".
- **Async & events:** none.
- **External systems:** none directly (providers live in WADEV/WABA/channel domains).
- **Settings:** `allowed_send_methods`, `default_send_method`, per-channel `*_enabled` switches, workspace `enabled_engines`/`default_engine`, plan feature `access_email`.
- **Acceptance criteria:**
  - Given allowed methods `[baileys, waba]` and a workspace with a primary connected WABA config, Then `for()` = `waba` and `enginesFor()` lists waba first then baileys when it owns a device.
  - Given a stale disconnected Twilio row while Twilio is not in `allowed_send_methods`, Then it never becomes the workspace engine.
  - Given `enabled_engines = ['waba']`, Then `availableFor()` and `enginesFor()` exclude baileys even if devices exist.
  - Given a bare sender key `"12"` and default engine waba, Then it parses to `waba:12`; Given `"foo:3"`, Then null.
  - Given an admin impersonating workspace W, Then senders for W exclude the admin's own NULL-workspace devices.
- **Source refs:** `app/Services/WorkspaceEngine.php`, `app/Models/WaProviderConfig.php`, `app/Models/Device.php`, `app/Models/WorkspaceIgAccount.php`, `app/Models/WorkspaceEmailAccount.php`.
- **Port notes:** target should expose a `SenderRegistry` port that channel modules register senders into (provider-adapter pattern), rather than one service that imports every channel model. Keep the sender-key format `<engine>:<id>` stable because flows, campaigns and mobile pin senders by it. Drop the orphan-device fallback (legacy data only).

### TW-WSP-012 — Request tenant context resolution (`current_workspace_id` semantics)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** -
- **Summary:** Defines how every request learns which workspace it acts on. There is no per-request tenant id in URLs: the browser session carries `users.current_workspace_id`, and four different mechanisms can override it **in memory only** (mobile header, tenant domain, impersonation, slug landing). All workspace-scoped queries read `current_workspace_id`.
- **Actors & access:** infrastructure. Applies to every authenticated web request (middleware appended to the `web` group in `bootstrap/app.php`: `ResolveTenantDomain` -> `Maintenance` -> `ImpersonationBanner` -> `RecordAgentActivity` -> `CaptureReferral` -> `EnsureUserActive` -> `EnsureTrialActive` -> ...) and the mobile API group.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** `users.current_workspace_id` (nullable bigint, no FK), `workspace_user`, `impersonation_sessions`, `workspaces.custom_domain/cname_verified`.
- **Rules & edge cases:**
  1. Resolution order for a web request: persisted `users.current_workspace_id` -> overridden in memory by tenant-domain lock (TW-WSP-013) -> overridden in memory by an active impersonation session (TW-WSP-033). The override always calls `setAttribute` then `syncOriginalAttribute` so an incidental `$user->save()` later in the request can never persist the target id onto the real user row (this closed a leak where an impersonated or mobile-selected workspace got "assigned" to the admin/user).
  2. Mobile API (`ResolveAppWorkspace`, MOB domain): header `X-Workspace-Id` (fallback body/query `workspace_id`) must name a workspace where the caller has a `workspace_user` row with `joined_at NOT NULL`, else 403 "You are not a member of that workspace."; then set in memory for that request only. No header = the persisted value. The app never writes `current_workspace_id`.
  3. The persisted column is shared by web and app, which is why in-memory overrides exist; the mobile create-workspace endpoint additionally restores the previous value after `WorkspaceProvisioner` switched it.
  4. Accessor `User::current_workspace` returns the workspace or falls back to `workspaces()->first()`; `switchWorkspace()` validates membership (TW-WSP-005).
  5. `EnsureWorkspaceMembership` (TW-WSP-014) was meant to verify membership and repair stale pointers but is not attached to any route in v1.7.0.
  6. `WorkspacePermissions::userCan` and `User::workspaceRole()` always evaluate the role against the resolved current workspace unless a workspace id is passed explicitly.
  7. Background jobs and webhooks do not use sessions: they carry an explicit `workspace_id` on the rows they process (messages, conversations, campaigns...); there is NO database-level isolation - tenancy is enforced only by application `where workspace_id` scopes (many legacy tables scope by `user_id` and later gained `workspace_id` via a 2026-05-19 backfill migration; some queries still fall back to user ownership - e.g. `Device::scopeForWorkspace` with NULL `workspace_id`).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a user whose persisted current workspace is A and an active impersonation session pointing at B, When a page loads, Then queries run against B but `users.current_workspace_id` in the database remains A after the request.
  - Given a mobile request with `X-Workspace-Id: C` where the user is only a pending invitee (joined_at NULL), Then the response is 403 and nothing is read.
  - Given a request with no override, Then queries use the persisted `current_workspace_id`.
- **Source refs:** `bootstrap/app.php` (middleware order), `app/Http/Middleware/ImpersonationBanner.php`, `app/Http/Middleware/ResolveTenantDomain.php`, `app/Http/Middleware/ResolveAppWorkspace.php`, `app/Models/User.php`, `app/Models/Device.php`.
- **Port notes:** target uses `org_id` in the JWT/session and RLS (`SET LOCAL app.current_org`) - no persisted "current" column. Replace the four in-memory override hacks with one `TenantContext` resolved by a Nest guard: JWT org claim -> (tenant-domain host mapping) -> (impersonation token claim `act_as_org`). Impersonation must mint a distinct short-lived token; never mutate the admin's principal.

### TW-WSP-013 — White-label custom-domain tenancy (`ResolveTenantDomain`)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M
- **Depends on:** TW-WSP-030, TW-WSP-012
- **Summary:** When the request host equals a workspace's verified `custom_domain`, the entire request is locked to that workspace: the workspace switcher disappears, logged-in non-members are signed out, and the app runs as that tenant. The storefront resolver also serves that workspace's shop on the domain.
- **Actors & access:** global `web` middleware; applies to any visitor on the custom host. The domain must be assigned by a platform admin (TW-WSP-024/026) and verified (TW-WSP-030). Workspace owners cannot self-serve set `workspaces.custom_domain` (the storefront wizard has its own separate `wa_storefronts.custom_domain`, STORE domain).
- **UX & screens:** shares `tenantWorkspace` and `isTenantDomain` with all views; header hides the switcher and "Create workspace"; a non-member who signs in on the domain is redirected to `login` with error "This site belongs to a different workspace. Sign in with an account that has access."
- **Endpoints:** none of its own (middleware).
- **Data:** reads `workspaces` where `custom_domain = host` AND `cname_verified = 1`; reads `workspace_user`.
- **Rules & edge cases:**
  1. No-op until the app is installed (`storage/installed` file absent) so the installer works without a database.
  2. No-op for the platform host (`APP_URL` host) and for any host that is not a verified custom domain; a DB error (missing table mid-migration, unreachable DB) also falls through - custom-domain routing must never 500 the app.
  3. Host match is exact, lower-cased `getHost()`; there is no wildcard/subdomain support and no www handling.
  4. Tenant found: binds `tenant.workspace` in the container and shares `tenantWorkspace`/`isTenantDomain` with views. If a user is logged in and is neither `owner_user_id` nor in `workspace_user` -> `Auth::guard('web')->logout()`, session invalidate + token regenerate, redirect to login with the error above. Members get `current_workspace_id` forced in memory (not persisted; a custom domain has its own session cookie).
  5. `switchWorkspace` refuses while `ResolveTenantDomain::isTenant()` ("Workspace switching is disabled on this domain.").
  6. Guests are not blocked: the tenant context only scopes what they see (storefront pages resolve the shop through `StorefrontPublicController`, which looks up `workspaces.custom_domain + cname_verified`).
  7. Suspended state, impersonation and trial gates run after this middleware and see the forced workspace.
  8. Helpers `ResolveTenantDomain::isTenant()` and `::tenant()` expose the tenant to controllers.
  9. SSL provisioning ("auto via Let's Encrypt") is stated in admin copy but nothing in the app provisions certificates - infra concern.
- **Async & events:** none.
- **External systems:** DNS (CNAME to `config('storefront.cname_target')` or the app host); TLS/edge is outside the app.
- **Settings:** `APP_URL`, `config/storefront.php` `cname_target`.
- **Acceptance criteria:**
  - Given workspace W with verified `custom_domain = crm.acme.com`, When a member signs in on `crm.acme.com`, Then the app scopes to W and the workspace switcher is hidden.
  - Given a signed-in user who is not a member of W, When they request any page on `crm.acme.com`, Then they are logged out and redirected to login with the "different workspace" error.
  - Given a domain that is set but `cname_verified = 0`, Then requests on that host behave as an unrecognised host (normal platform behaviour).
  - Given the database is down, Then the request is not 500'd by this middleware.
- **Source refs:** `app/Http/Middleware/ResolveTenantDomain.php`, `app/Http/Controllers/AuthController.php` (switchWorkspace guard), `app/Http/Controllers/StorefrontPublicController.php` (host resolver), `resources/views/components/user/header.blade.php`.
- **Port notes:** implement as a Next.js middleware / API gateway host map (`tenant_domains` table: host, org_id, verified_at, certificate status) with a short-TTL cache. Do NOT locate the org by host on every API call in the Nest handler; resolve once at the edge and pass a signed tenant header. Add wildcard and www handling and certificate automation (Caddy/Cloudflare) as new work.

### TW-WSP-014 — Suspended-workspace guard and suspended screen (`EnsureWorkspaceMembership`)

- **Status:** dead-code
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** TW-WSP-027, TW-WSP-028
- **Summary:** Middleware alias `workspace.member` verifies that the user's current workspace still lists them as a member (repairing stale pointers) and blocks members of a suspended/frozen workspace with a 403 "Workspace suspended" screen. It is registered but attached to no route in v1.7.0, so none of this runs.
- **Actors & access:** alias `workspace.member` -> `app/Http/Middleware/EnsureWorkspaceMembership.php`. Grep of `routes/*.php` and the `web` group finds no usage (a comment in `TeamInboxController` still claims the inbox is behind `auth + workspace.member`).
- **UX & screens:** `resources/views/workspace-suspended.blade.php` (403): heading "This workspace is suspended", body "Access to <workspace> has been paused by the <brand> team. If you think this is a mistake, please contact support to have it reviewed.", buttons "Contact support" (`/support`) and "Sign out" (POST). Only rendered by this middleware.
- **Endpoints:** none.
- **Data:** reads `workspace_user`, `workspaces.status`, `workspace_flags`, `impersonation_sessions`; writes `users.current_workspace_id`.
- **Rules & edge cases:** (intended behavior, if it were wired)
  1. No user -> 401. No current workspace -> redirect `/workspaces/select` (QUIRK: that route does not exist anywhere in the app, so it would 404).
  2. User not a member of their current workspace: exempt when an ACTIVE impersonation session (admin, same target) exists; else move them to their first workspace or clear the pointer and redirect to `/workspaces/select`.
  3. If the (now current) workspace has `status = false` or an uncleared `frozen|tos_violation|fraud` flag: switch the user to another ACTIVE workspace and redirect `/`; if none, respond 403 with the suspended screen.
  4. Consequence today: `workspaces.status=false` (suspend) and workspace flags have NO enforcement on web requests; members of a suspended workspace keep working. Only `users.role='suspended'` is enforced (via `EnsureUserActive`, TW-WSP-040). Treat suspension as _recorded but not enforced_ in v1.7.0 and confirm live (see Open questions).
  5. Removed members keep `users.current_workspace_id` pointing at the workspace they were removed from (TW-WSP-018); with this guard unattached nothing repairs it, though `workspaceRole()` returns null so role-gated routes redirect them.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the middleware were attached and a workspace has an uncleared `frozen` flag, When a member requests any page, Then they are moved to another active workspace or see the 403 suspended screen.
  - Given an admin with an active impersonation session viewing a workspace they do not belong to, Then they are not corrected off it.
  - (Parity check for the port) Given a suspended workspace in the target platform, Then API requests from its members must be rejected consistently (this is the intended behavior Reference failed to wire).
- **Source refs:** `app/Http/Middleware/EnsureWorkspaceMembership.php`, `bootstrap/app.php` (alias only), `resources/views/workspace-suspended.blade.php`, `app/Models/Workspace.php` (isSuspended).
- **Port notes:** implement suspension as an org-level `status` checked in the Nest tenant guard (reject with `ORG_SUSPENDED` problem+json, allow read of billing/support endpoints), with an explicit allow-list for platform impersonation. Include the "redirect to another active org" behavior only if multi-org membership is adopted.

### TW-WSP-015 — Members page (list, filters, statuses)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WSP-020
- **Summary:** Team Inbox > Members shows everyone in the current workspace with role, live presence and joined date, with role filters, search and per-row actions.
- **Actors & access:** page route `Authenticate` + `workspace.role:admin` (Admin/Owner; platform admins bypass). Agents/Viewers are redirected to `/team-inbox`, Managers get 403. The list API `GET team-inbox/api/members` has no role gate (any authenticated user of the workspace) and no membership check beyond `current_workspace_id`. Buttons are hidden by permission: role selects need `member.role.assign`; reset/remove need `member.invite`; "Invite teammate" needs `member.invite`.
- **UX & screens:** `resources/views/user/team-inbox/members.blade.php` + `resources/js/charts/user-team-inbox-members.js`. Header "Team members" ("Everyone with access to <workspace>. Roles control..."), sidebar role filter pills with live counts (All, Owners, Admins, Managers, Agents, Viewers; legacy `member` counts as Agent) and a "How roles work" card, main table (Name+email, Role select or read-only badge, Status dot + label online/away/busy/offline, Joined date or italic "pending", Actions: reset-password and remove icons), search box (name/email, 150 ms debounce). Empty state "No data found / No members ... match this view" with an "Invite member" button. Loads `/team-inbox/api/bootstrap` (for `permissions`) and `/team-inbox/api/members` in parallel; toasts on errors ("Failed to load members: ...").
- **Endpoints:**

  | Endpoint                   | Route name                        | Action                           | Middleware                              | Request | Response                                       |
  | -------------------------- | --------------------------------- | -------------------------------- | --------------------------------------- | ------- | ---------------------------------------------- |
  | GET team-inbox/members     | user.team-inbox.members           | WorkspaceMembersController@page  | Authenticate, EnsureWorkspaceRole:admin | -       | members view                                   |
  | GET team-inbox/api/members | user.team-inbox.api.members.index | WorkspaceMembersController@index | Authenticate                            | -       | JSON `{members[], roles[], grantable_roles[]}` |

- **Data:** joins `workspace_user` x `users` (id, name, email, role, joined_at, invited_at) for the current workspace ordered by `role` (alphabetical string sort: admin, agent, manager, owner, viewer) then `name`; left data from `agent_statuses` (status, last_seen_at) keyed by user for the workspace, default `offline`.
- **Rules & edge cases:**
  1. Each member object: id, name, email, role, invited_at, joined_at, agent_status, last_seen_at. `roles` = all five roles; `grantable_roles` = the roles the caller may grant (TW-WSP-020 rule 4). No pagination, no server search.
  2. Soft-deleted users still appear (the query is a raw join without the `deleted_at` filter) (QUIRK).
  3. A row with `joined_at` NULL is a pending invite (label "pending").
  4. The pending-invite/"status" for the Settings > Team tab is derived elsewhere as `invited` vs `active` from `joined_at`.
  5. Role sort is lexical not by hierarchy (QUIRK).
- **Async & events:** none (no realtime; presence values are whatever `agent_statuses` last stored).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an admin opens the page, Then all workspace members are listed with role, status and joined date, and pill counts per role match.
  - Given an agent navigates to `/team-inbox/members`, Then they are redirected to `/team-inbox` with a warning about their role.
  - Given a search "riya", Then only members whose name or email contains it remain, case-insensitively.
  - Given a member with `joined_at` NULL, Then "pending" shows in Joined.
- **Source refs:** `app/Http/Controllers/WorkspaceMembersController.php` (page, index), `resources/views/user/team-inbox/members.blade.php`, `resources/js/charts/user-team-inbox-members.js`, `app/Models/AgentStatus.php`, `Documentation/pages/account/team-members.html`.
- **Port notes:** target `users` + `user_roles` (RBAC v3) replaces the pivot role; members list should be cursor-paginated and RLS-scoped, exclude deactivated users, and include presence from the realtime layer (TIB2/TCHAT). The `roles` payload becomes the org's role list.

### TW-WSP-016 — Invite member (existing or new account, temp password, seat limit)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WSP-020, TW-WSP-010
- **Summary:** An admin/owner invites a teammate by name, email and role. An existing Reference account is attached to the workspace immediately; a new email gets an account with a one-time random password shown to the inviter (and emailed when a real mail transport exists). Inviting counts against the plan's seat limit.
- **Actors & access:** route `Authenticate`; controller requires workspace permission `member.invite` (Owner, Admin) -> else 403 "You do not have permission to invite members." Role grant rule via `canGrantRole` (TW-WSP-020): only Owner may grant `owner` or `admin`; Manager/Agent/Viewer by anyone with `member.invite`/`member.role.assign` who is at least as senior. Plan gate: `user_seat_limit` (count of ALL `workspace_user` rows for the workspace, pending included; platform admins bypass).
- **UX & screens:** Members page "Invite teammate" modal (`#invite-modal`): **Full name** (required, max 191), **Email** (required, max 191), **Workspace role** select (Agent, Manager, Admin, Viewer; Owner only rendered for users with `member.role.assign` via `@canWorkspace`; note the UI offers Admin to admins although the server will refuse it - the server error message is shown). Helper text: "We'll email them an invite. If email isn't deliverable we'll show a one-time password you can share manually." Submit button "Send invite" ("Sending..."). Result box: new account -> "<name> added." + credentials box (Email + Password, selectable) with tail text depending on `email_sent`; existing account -> "already has a Reference account ... use the Reset password action"; errors in a coral box. Then the list reloads and toast "Teammate invited."
- **Endpoints:**

  | Endpoint                           | Route name                         | Action                            | Middleware   | Request           | Response                                                                                                  |
  | ---------------------------------- | ---------------------------------- | --------------------------------- | ------------ | ----------------- | --------------------------------------------------------------------------------------------------------- |
  | POST team-inbox/api/members/invite | user.team-inbox.api.members.invite | WorkspaceMembersController@invite | Authenticate | email, name, role | JSON `{ok, member{id,name,email,role}, temp_password, email_sent, existing_user, message}` or 403/409/422 |

- **Data:** reads/creates `users` (name, email, password, role `'U'`, site_name), writes `workspace_user` (role, invited_at now, joined_at now-or-null), maybe `users.current_workspace_id`, `audit_logs` via `AuditLogger::workspace('member.invited', ...)` with payload email, role, new_user, email_sent.
- **Rules & edge cases:**
  1. Order: permission check -> seat limit check (BEFORE validation, so a full workspace reports the limit even for an invalid payload; error is `PlanLimitReachedException` -> 422 JSON `{ok:false,error:'plan_limit_reached',key:'user_seat_limit',used,limit,message}`) -> validation (`email` required email max 191; `name` required max 191; `role` required in owner|admin|manager|agent|viewer) -> role-grant check (403 "You don't have permission to grant the <role> role.").
  2. Existing user (`users.email` exact match; soft-deleted users are NOT found - QUIRK: inviting the email of a trashed account tries to create a new user and violates the global unique email index -> 500): reuse. New user: `Str::random(12)` temp password (hashed by the model cast), `role='U'` (legacy platform role value, which the admin users screens do not recognise as `user`), `site_name = slug(name)-<4 random lower>`; the account is created with no email verification and `force_password_change` NOT set (the UI/email imply a change is required, code does not enforce it).
  3. Already a member of this workspace -> 409 `{ok:false, message:"<email> is already a member of this workspace."}` (checked AFTER the user may already have been created; a fresh account is never in this branch).
  4. Attach with `invited_at = now`; `joined_at = now` for an existing user, `NULL` for a brand-new user (becomes joined on first login, TW-WSP-021). The pivot table has a unique index (workspace_id, user_id).
  5. If the invitee has no `current_workspace_id`, it is set to this workspace (auto-switch on first login).
  6. Email: sent only when the default mailer is a real transport (not `log`, `array`, `null`, empty, and not `smtp` without a host); wrapped in try/catch, failure logged as a warning; sends `TeamInviteMail` (subject "You've been invited to <workspace> on <app name>", view `mail/team-invite`: inviter name, workspace, role, temp password block for new users or "existing account added" copy, "Sign in" button to `/login`).
  7. Response `message` variants: emailed + temp password -> "Invite sent to <email>. We've also shown the temp password below..."; emailed existing -> "<name> (<email>) was added and notified by email."; not emailed + new -> "Created. Email couldn't be sent - share these credentials with <name>: email <email>, password <pw>."; not emailed + existing -> "... They sign in with their existing Reference password."
  8. The temp password is returned ONCE in the response only; it is never retrievable later (Reset password, TW-WSP-019, is the recovery).
  9. An invite of an existing user does not require the invitee to accept; they are `joined` immediately. There is no token/magic-link acceptance flow, no expiry, and no re-send endpoint.
  10. Under impersonation the inviter is treated as Owner of the target workspace (TW-WSP-033), so platform staff can invite as owner.
- **Async & events:** `Mail::to()->send` is synchronous (not queued); audit row `member.invited`.
- **External systems:** Laravel mailer (SMTP/API) configured by admin mail settings/.env.
- **Settings:** package limit `user_seat_limit`; mail config `MAIL_MAILER`, host, from.
- **Acceptance criteria:**
  - Given an Owner and a new email, When they invite with role agent, Then a user is created, a `workspace_user` row (`invited_at` set, `joined_at` NULL) exists, the response contains a 12-char `temp_password`, `existing_user=false`, and an audit `member.invited` row exists.
  - Given an existing account's email, When invited as manager, Then the row has `joined_at` set, no temp password, `existing_user=true`.
  - Given an Admin (not owner), When they invite with role `admin` or `owner`, Then 403 "You don't have permission to grant the admin role."
  - Given the workspace's seat count equals `user_seat_limit`, When anyone but a platform admin invites, Then 422 `plan_limit_reached` for `user_seat_limit`.
  - Given the email already belongs to a member, Then 409 "... is already a member of this workspace."
  - Given `MAIL_MAILER=log`, Then `email_sent=false` and the temp password is still returned.
- **Source refs:** `app/Http/Controllers/WorkspaceMembersController.php` (invite), `app/Mail/TeamInviteMail.php`, `resources/views/mail/team-invite.blade.php`, `app/Support/WorkspacePermissions.php`, `app/Services/PlanLimitGuard.php`, `resources/views/user/team-inbox/members.blade.php`, `resources/js/charts/user-team-inbox-members.js`, `Documentation/pages/account/team-members.html`.
- **Port notes:** the target should invite by single-use token link (email) with expiry and resend, and must NOT hand out plaintext passwords; if a manual fallback is needed, generate a one-time set-password link. Users are per-org in the target (unique email per org), so "existing account" = same person already in another org requires an account-level identity table (see TW-WSP-047). Enqueue the email via the outbox. Seat limit check should count active + pending invites against the org's plan.

### TW-WSP-017 — Change member role

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S
- **Depends on:** TW-WSP-020
- **Summary:** Owners and admins change another member's workspace role from the row's role dropdown; the change applies to that member's next request.
- **Actors & access:** requires `member.role.assign` (Owner, Admin) else 403 (no message). Self-change blocked. Granting `owner` or `admin` requires the caller to be Owner.
- **UX & screens:** inline `<select>` per row listing all five roles (Owner/Admin/Manager/Agent/Viewer); on change PATCHes immediately, toasts "Role updated." then reloads; on failure toasts "Update failed: <message>" and reloads (resets the select).
- **Endpoints:**

  | Endpoint                                   | Route name                       | Action                                | Middleware   | Request | Response         |
  | ------------------------------------------ | -------------------------------- | ------------------------------------- | ------------ | ------- | ---------------- |
  | PATCH team-inbox/api/members/{userId}/role | user.team-inbox.api.members.role | WorkspaceMembersController@updateRole | Authenticate | role    | JSON `{ok:true}` |

- **Data:** updates `workspace_user.role` and `updated_at` for (workspace, user); `audit_logs` `member.role_changed` payload `{role}`.
- **Rules & edge cases:**
  1. Validation: `role` required, one of owner|admin|manager|agent|viewer.
  2. `userId == caller` -> 422 "You cannot change your own role."
  3. `canGrantRole(caller, newRole)`: else 403 "You don't have permission to grant the <role> role."
  4. QUIRK: the code never checks the TARGET's current role. An Admin can set an Owner (or another Admin) down to Manager/Agent/Viewer because grant checks look only at the new role. It also does not require the target to be a member: an unknown userId updates 0 rows and still returns `{ok:true}`. It does not touch `workspaces.owner_user_id`, so the Owner-by-pivot and Owner-by-column can diverge (settings, deletion and platform billing checks use the column).
  5. Promoting a member to `owner` does not transfer ownership (`owner_user_id`) and the previous owner keeps their role: multiple `owner` pivot rows are possible.
  6. Legacy pivot role `member` behaves as Agent everywhere (`permissionsFor` aliases it) but is offered nowhere.
- **Async & events:** audit row only; no notification to the member.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an Owner and an agent member, When they set the role to manager, Then `workspace_user.role='manager'`, `{ok:true}` and an audit `member.role_changed` row exist.
  - Given a caller changing their own role, Then 422 "You cannot change your own role."
  - Given an Admin setting a member to `admin`, Then 403.
  - Given an Admin demoting the Owner to viewer, Then it succeeds (documented Reference behavior; the port should decide whether to keep it).
- **Source refs:** `app/Http/Controllers/WorkspaceMembersController.php` (updateRole), `app/Support/WorkspacePermissions.php`, `resources/js/charts/user-team-inbox-members.js`.
- **Port notes:** map onto `user_roles` (RBAC v3) with an immutable locked Admin preset; enforce "cannot demote the last owner" and "cannot act on a higher-ranked target" (Reference lacks both) and add ownership transfer as an explicit action. Bump `roles_version` on change so caches invalidate.

### TW-WSP-018 — Remove member

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S
- **Depends on:** TW-WSP-020, TW-WSP-022
- **Summary:** Owners and admins remove a member from the workspace and from any teams inside it; the person loses workspace access immediately (the user account itself is untouched).
- **Actors & access:** requires `member.invite` (Owner, Admin) else 403. Cannot remove yourself (422) or the workspace owner (`owner_user_id`, 422).
- **UX & screens:** trash icon per row; browser confirm "Remove <name> from this workspace? They'll lose access immediately."; toast "Removed." or "Remove failed: <msg>".
- **Endpoints:**

  | Endpoint                               | Route name                          | Action                             | Middleware   | Request     | Response         |
  | -------------------------------------- | ----------------------------------- | ---------------------------------- | ------------ | ----------- | ---------------- |
  | DELETE team-inbox/api/members/{userId} | user.team-inbox.api.members.destroy | WorkspaceMembersController@destroy | Authenticate | path userId | JSON `{ok:true}` |

- **Data:** deletes the `workspace_user` row(s) and every `team_user` row for that user within this workspace's teams; audit `member.removed` (subject user).
- **Rules & edge cases:**
  1. 422 "You cannot remove yourself from the workspace." / 422 "Cannot remove the workspace owner." (the check is against `workspaces.owner_user_id`, not the pivot role, so another user holding pivot role `owner` CAN be removed and an Admin can remove other Admins).
  2. Removing a non-member silently succeeds (`{ok:true}`).
  3. NOT done (QUIRK): the removed user's `current_workspace_id` is not cleared or repaired, open conversations assigned to them stay assigned, their `agent_statuses` row and notifications remain; API tokens are not revoked. With `EnsureWorkspaceMembership` unwired (TW-WSP-014) the stale pointer is only neutralised because `workspaceRole()` returns null.
  4. Also does not delete the user's login; the same person can be re-invited later (their `joined_at` restarts).
- **Async & events:** audit row only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an Admin and an agent member in two teams, When the Admin removes the agent, Then the pivot and both `team_user` rows are deleted and an audit `member.removed` row exists.
  - Given the caller targets themselves, Then 422 and nothing changes; given the target is `owner_user_id`, Then 422.
  - Given a manager caller, Then 403.
- **Source refs:** `app/Http/Controllers/WorkspaceMembersController.php` (destroy), `resources/js/charts/user-team-inbox-members.js`, `Documentation/pages/account/team-members.html`.
- **Port notes:** on removal emit `member.removed` through the outbox so TIB consumers unassign/reassign conversations and revoke sessions; delete `team_members` rows in the same transaction.

### TW-WSP-019 — Reset member password (one-time temp password)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** TW-WSP-020
- **Summary:** For members whose account was added by invite (especially existing accounts whose password the inviter cannot see) an admin can reset the password to a fresh random 12-char value shown once, with a best-effort email to the member.
- **Actors & access:** requires `member.invite` (Owner, Admin) else 403 "You do not have permission to reset member passwords." Target must be in this workspace (404 "This person is not a member of your workspace."). If the target is the workspace owner (`owner_user_id`) the caller must be able to grant the Owner role (i.e. be Owner) else 403 "Only a workspace owner can reset the owner's password."
- **UX & screens:** lock icon per row; confirm "Reset <name>'s password? A new temporary password will be shown once - their current password stops working immediately."; success shows a dismissible banner "New password for <name>" with Email/Password and tail text ("We also emailed it..." or "Email isn't configured on this server, so share these credentials with them directly").
- **Endpoints:**

  | Endpoint                                            | Route name                                 | Action                                   | Middleware   | Request     | Response                                                                                                                  |
  | --------------------------------------------------- | ------------------------------------------ | ---------------------------------------- | ------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------- |
  | POST team-inbox/api/members/{userId}/reset-password | user.team-inbox.api.members.reset-password | WorkspaceMembersController@resetPassword | Authenticate | path userId | JSON `{ok, member{id,name,email}, temp_password, email_sent, message:"Password reset. Share the new credentials below."}` |

- **Data:** updates `users.password` (hashed); audit `member.password_reset` `{email, email_sent}`; sends `TeamInviteMail` reusing the invite template with the member's current role and the temp password.
- **Rules & edge cases:**
  1. Admins can reset ANY member's password including other Admins/Managers (only the workspace owner is protected), and the account may belong to several workspaces - so an admin of workspace A can lock out a user's access to workspaces B and C (QUIRK: cross-tenant blast radius).
  2. The code comment says the member is forced to change the password on next login; the code does NOT set `force_password_change` (and nothing enforces that flag anyway).
  3. Existing sessions and remember-me tokens of the target are not revoked.
  4. Email only via a real transport (same rule as invite); the response always includes `temp_password`.
  5. Rate limiting: none on this endpoint.
- **Async & events:** mail sync; audit.
- **External systems:** mailer.
- **Settings:** mail config.
- **Acceptance criteria:**
  - Given an Admin and an agent member, When they reset, Then the response returns a 12-char temp password, the old password no longer works and an audit `member.password_reset` exists.
  - Given the target is the workspace owner and the caller is an Admin, Then 403.
  - Given a target user not in this workspace, Then 404.
- **Source refs:** `app/Http/Controllers/WorkspaceMembersController.php` (resetPassword), `app/Mail/TeamInviteMail.php`, `resources/js/charts/user-team-inbox-members.js`.
- **Port notes:** replace with an emailed one-time set-password link scoped to the org; never display a plaintext password. If per-org users are kept (target design), the blast-radius issue disappears.

### TW-WSP-020 — Workspace role model, permission matrix and role gates

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L
- **Depends on:** -
- **Summary:** Five workspace roles (owner 100, admin 80, manager 60, agent 40, viewer 20) with a fixed role->permission map, evaluated per workspace, plus route middleware, Eloquent policies and a Blade directive built on it. This is independent of the platform-level Spatie roles used by `/admin`.
- **Actors & access:** every authenticated workspace member; platform admins bypass workspace-role gates.
- **UX & screens:** nav items and buttons are hidden when the permission is missing (`@canWorkspace('perm')`); Agents/Viewers hitting a manager+ page are redirected to `/team-inbox` with warning "Your role (<role>) doesn't have access to that page."; Manager+ get 403 with the same text.
- **Endpoints:** applies through middleware `workspace.role:<min>` (15 routes use `admin`, 24 use `manager`; RBAC/other domains own those routes) and `WorkspacePolicy`/`TeamPolicy`.
- **Data:** `workspace_user.role` (varchar 32, default `'member'` from the original migration = treated as agent).
- **Rules & edge cases:**
  1. Permission catalog (23): inbox.view_all_teams, inbox.view_team, inbox.view_assigned, inbox.reply, inbox.note, inbox.assign, inbox.assign_self, inbox.resolve, inbox.snooze, inbox.bulk, inbox.tag, inbox.priority, team.manage, tag.manage, routing.manage, sla.manage, savedreply.manage, member.invite, member.role.assign, workspace.settings, workspace.billing, analytics.view, integration.manage.
  2. Matrix: **Owner** = all 23. **Admin** = all except `workspace.billing`. **Manager** = inbox.* (all 12) + tag.manage, savedreply.manage, analytics.view. **Agent** = inbox.view_all_teams, view_team, view_assigned, reply, note, resolve, snooze, assign_self, tag (Agents get view_all_teams deliberately so the "All" tab agrees with the inbox list; assignment is claim-only for themselves, enforced in `ConversationPolicy::assign`). **Viewer** = inbox.view_team, inbox.view_assigned only. Unknown/legacy `member` = Agent.
  3. `userCan(user, perm, wsId?)`: workspace defaults to `current_workspace_id`; role from `User::workspaceRole()` = pivot role, or **Owner** when the user is a platform admin actively impersonating that workspace (session-bound, TW-WSP-033); non-member = null = denied.
  4. `canGrantRole(actor, target)`: only an Owner can grant `owner`; only an Owner can grant `admin` (no admin->admin chains); for the other roles the actor needs `member.role.assign` or `member.invite` AND `rank(actor) >= rank(target)`. `grantableRolesFor(actor)` filters the five roles through it.
  5. `EnsureWorkspaceRole(minRole)`: no user -> login; platform admins (Spatie Super Admin/Admin or legacy `users.role` in admin, super-admin, super_admin, platform-admin) always pass; no workspace role -> if the user has zero workspaces redirect to `register.workspace` else to `/team-inbox`; role rank >= min passes; below the bar Agent/Viewer are redirected to `/team-inbox` with warning, Manager gets 403.
  6. `WorkspacePolicy`: view = platform `platform.workspace.view_all` or member; update = `workspace.settings`; manageMembers = `member.invite`; impersonate/suspend/flag = platform permissions `platform.workspace.impersonate|suspend|flag`. `TeamPolicy`: viewAny = has a current workspace; view = member of the team's workspace; create/update/delete = `team.manage` in that workspace (update/delete also require membership). `ConversationPolicy` (TIB1/TIB2) consumes the inbox.* keys.
  7. Blade directive `@canWorkspace('perm', wsId?)` for views; `/team-inbox/api/bootstrap` returns the caller's `permissions` map for JS.
  8. Documentation states Admin = "everything except billing" - matches the matrix; workspace pages like Broadcasts need Admin, Dashboard needs Manager (per route middleware).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none (fixed matrix in code; not editable per workspace).
- **Acceptance criteria:**
  - Given an Agent, Then `userCan(inbox.assign)` is false and `userCan(inbox.assign_self)` is true.
  - Given an Admin, Then `userCan(workspace.billing)` is false; an Owner true.
  - Given a Manager opens a route gated `workspace.role:admin`, Then 403; an Agent is redirected to `/team-inbox`.
  - Given a legacy role `member`, Then permissions equal Agent's.
  - Given an Admin, Then `grantableRolesFor` = manager, agent, viewer; an Owner = all five.
- **Source refs:** `app/Support/WorkspacePermissions.php`, `app/Http/Middleware/EnsureWorkspaceRole.php`, `app/Policies/WorkspacePolicy.php`, `app/Policies/TeamPolicy.php`, `app/Providers/AppServiceProvider.php` (Gate::policy, Blade::if canWorkspace), `app/Models/User.php` (workspaceRole), `Documentation/pages/account/team-members.html`, `Documentation/pages/getting-started/workspaces.html`.
- **Port notes:** RBAC domain owns the general engine (`permission_defs`, `role_grants`, `user_roles`); seed these five as system roles (owner may map to the locked Admin preset + an `is_owner` flag on the org) and register the 23 keys in `permission_defs` (use the `rbac-permission` skill). The hierarchy rules (`canGrantRole`) are business logic on top of RBAC and must live in the identity module. Keep the alias of legacy `member` = agent only for imported data.

### TW-WSP-021 — Pending invitation activation on login

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** TW-WSP-016
- **Summary:** A member invited as a brand-new user is "pending" (`joined_at` NULL) until they sign in; the first successful login activates all their pending memberships.
- **Actors & access:** automatic on any successful login (email/password in `AuthController@login`, and the `Illuminate\Auth\Events\Login` listener for social/remember-me/other guards).
- **UX & screens:** the Members page shows "pending" in Joined until then; Settings > Team lists status `invited` vs `active` computed from `joined_at`.
- **Endpoints:** none (login flow, AUTH domain).
- **Data:** `UPDATE workspace_user SET joined_at = now() WHERE user_id = ? AND joined_at IS NULL` (all workspaces at once); log lines `[invite-accept]` (temporary diagnostic logging left in code).
- **Rules & edge cases:**
  1. Idempotent (`whereNull`); failures are caught and logged, never blocking login.
  2. Runs twice on password login (controller and event listener) - harmless.
  3. There is no per-workspace accept, decline or expiry; a pending row already grants full access (TW-WSP-005 lets pending invitees switch in; only the mobile API requires `joined_at`).
  4. `AuthLogin` listener also writes audit `auth.login`, sends new-device alerts and triggers admin workspace provisioning (TW-WSP-034).
- **Async & events:** synchronous DB update.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a user with two pending memberships, When they log in successfully, Then both rows get `joined_at = now`.
  - Given a login via Google, Then pending memberships are also activated.
  - Given the update fails, Then login still succeeds.
- **Source refs:** `app/Http/Controllers/AuthController.php` (login), `app/Providers/AppServiceProvider.php` (Login event listener).
- **Port notes:** with token-based invites, accepting the invite is the activation; drop the implicit login-time activation.

### TW-WSP-022 — Teams within a workspace (CRUD)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M
- **Depends on:** TW-WSP-020
- **Summary:** Workspaces group members into teams (e.g. Sales, Support) used by the Team Inbox for queues, assignment strategy and device scoping. Teams are created, edited and deleted from the Team Inbox settings modals.
- **Actors & access:** list = any authenticated user of the workspace (no permission check); create = `team.manage` (Owner, Admin) else 403; update/delete = `TeamPolicy` (`team.manage` in the team's workspace AND membership). Routes are under `team-inbox/api` with `Authenticate` only.
- **UX & screens:** Team Inbox page `user/team-inbox/index.blade.php` + `resources/js/charts/user-team-inbox-index.js`: "Create team" modal (name, colour swatch picker, assignment strategy select, member checkboxes with online status, device checkboxes - shown only when the workspace has more than one device; empty selection = all devices) and "Edit team" modal (same plus Delete with confirm "Delete team \"X\"? Conversations assigned to this team will become unassigned."). Toasts: "Team created.", "Team updated.", "Team deleted.", "Create team failed: ...".
- **Endpoints:**

  | Endpoint                         | Route name                        | Action                           | Middleware   | Request                                                                | Response                                                      |
  | -------------------------------- | --------------------------------- | -------------------------------- | ------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
  | GET team-inbox/api/teams         | user.team-inbox.api.teams.index   | TeamInboxController@teamsIndex   | Authenticate | -                                                                      | JSON array of teams with `members:id,name`, ordered by `sort` |
  | POST team-inbox/api/teams        | user.team-inbox.api.teams.store   | TeamInboxController@teamsStore   | Authenticate | name, color, description, assignment_strategy, members[], device_ids[] | `{ok, team}`                                                  |
  | PATCH team-inbox/api/teams/{id}  | user.team-inbox.api.teams.update  | TeamInboxController@teamsUpdate  | Authenticate | same, all optional                                                     | `{ok, team}`                                                  |
  | DELETE team-inbox/api/teams/{id} | user.team-inbox.api.teams.destroy | TeamInboxController@teamsDestroy | Authenticate | -                                                                      | `{ok:true}`                                                   |

- **Data:** `teams` (workspace_id, name, slug, color, description, default_assignee_user_id, assignment_strategy, business_hours JSON, timezone, device_ids JSON, is_default, sort, soft delete), `team_user` (team_id, user_id, is_lead, capacity default 20); audit `team.created|updated|deleted`.
- **Rules & edge cases:**
  1. Create validation: `name` required max 64; `color` optional max 16 regex `^#?[0-9A-Za-z_-]{1,16}$` (default `#075E54`); `description` max 255; `assignment_strategy` in manual|round_robin|least_loaded|sticky (default `manual`); `members` array of integers; `device_ids` array of ints that must exist in `devices`. Slug = `slug(name)-<4 random>` (unique per workspace).
  2. `device_ids` are intersected with devices whose `user_id` is a user whose `current_workspace_id` equals this workspace (a forged id from another tenant is dropped); empty result stores NULL = "any device". `Team::handlesDevice(deviceId)`: null/empty allows all; a listed set only allows those.
  3. QUIRK: `members` ids are NOT validated as workspace members - any user id can be attached to a team (cross-tenant assignment possible), and update `sync()`s the full list (removal of unlisted members). `is_lead`/`capacity` are never set through this API (defaults false/20).
  4. Update uses `sometimes` rules; `description`/`members`/`device_ids` are nullable. `color` on update is `sometimes` (cannot be cleared).
  5. Delete is a soft delete; conversations with `assignee_team_id` to it are NOT cleared by this code (the UI copy claims they become unassigned; QUIRK: verify against the inbox behavior in TIB2).
  6. `is_default`, `default_assignee_user_id`, team `business_hours`/`timezone` exist in the schema/model but no create/update field writes them here (`is_default` may be set by routing/seed code in TIB2).
  7. `RoutingEngine`/`AssignmentService`/`NotificationDispatcher` consume `teams` and `Team::STRATEGIES` (TIB2): strategy meanings live there.
  8. Removing a workspace member deletes their `team_user` rows (TW-WSP-018).
- **Async & events:** audit rows.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an Admin, When they POST a team with a name, colour and two members, Then a team with a unique slug is created, two `team_user` rows exist and audit `team.created` is written.
  - Given a manager, When they POST, Then 403.
  - Given `device_ids` containing a device of another workspace, Then it is stripped from the saved list.
  - Given PATCH with `members: []`, Then all members are removed from the team.
  - Given a team in workspace A and a caller who is not a member of A, When they PATCH/DELETE it, Then 403.
- **Source refs:** `app/Http/Controllers/TeamInboxController.php` (teamsIndex/Store/Update/Destroy, intersectWorkspaceDevices), `app/Models/Team.php`, `app/Policies/TeamPolicy.php`, `resources/js/charts/user-team-inbox-index.js`, `resources/views/user/team-inbox/index.blade.php`.
- **Port notes:** target already has `teams` and `team_members` (org-scoped, unique name); add columns for color, description, assignment_strategy, device scoping, capacity, is_lead. Validate member ids against org users (Reference does not). Slug can be dropped (uuid is the external id). Coordinate with TIB2 (routing/assignment owner).

### TW-WSP-023 — Admin: workspace list

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WSP-010
- **Summary:** Admin > Workspaces lists every customer workspace with search, status/plan filters, sort, per-row plan/expiry/MRR/7-day volume/health, owner contact links and a row action menu; a KPI strip summarises the platform.
- **Actors & access:** `/admin/*` group middleware `web, auth, admin, ip.allowlist` (i.e. `EnsureUserIsAdmin` = Spatie role Super Admin/Admin or legacy `users.role` admin/`A`, plus the optional IP allow-list). No per-action Spatie permission is checked here (the seeded `workspaces.view` etc. keys are never enforced - see Open questions).
- **UX & screens:** `resources/views/admin/workspaces/index.blade.php` (page key `workspaces-index`, JS `resources/js/charts/workspaces-index.js` = only the floating row menu; note the same file registered as `workspaces-index` contains no chart code, while `workspaces-detail.js` is an unused prototype with fake chart data). Header "All workspaces" + "Create workspace" button. KPI cards: Total (+N this month), Active (retention %), Trial/free ("no paid plan"), Suspended ("action required"), Platform MRR ("active subs"). Filter bar: status pills All/Active/Suspended with counts (posted as `status`), plan `<select>` (auto-submits), sort `<select>` (ID desc, Created desc, Last active desc), search box "Search workspace, owner, slug...". Table columns: Workspace (initial tile, name link to detail, slug, industry), Owner (name, email mailto, mobile with country code unmasked as `tel:` and a wa.me link), Plan (coloured pill by name; expiry line "Trial ends - Nd" / "Renews - Nd" / "Expires today" / "Expired", coral <= 3 days, amber <= 7 days), MRR (currency-formatted), 7d msgs, Status/health badge, Last active (relative). Suspended rows tinted. Row menu: Open dashboard; Edit & change plan (`?edit=1#edit-panel`); Login as owner (prompt for reason, min 8 chars); Suspend or Reactivate; Move to trash (confirm "Move X to trash? Owner will be locked out until it's restored."). Empty state "No workspaces match your filters." Footer "Showing a-b of N workspaces" with pagination.
- **Endpoints:**

  | Endpoint             | Route name             | Action                           | Middleware                                   | Request                                                                      | Response |
  | -------------------- | ---------------------- | -------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- | -------- |
  | GET admin/workspaces | admin.workspaces.index | Admin\WorkspacesController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | q, status (all/active/suspended), plan_id, sort (mrr/created/lastseen), page | HTML     |

- **Data:** reads `workspaces` (+`owner`), `packages`, `messages` (last-7-day outbound counts grouped by workspace_id for the page's ids).
- **Rules & edge cases:**
  1. Search matches `name`, `slug`, or owner `name`/`email` (LIKE %q%). `status=active` -> `status=1`; `suspended` -> `status=0`; numeric `plan_id` filters `workspaces.plan = (int)` (exact numeric compare against the stored value).
  2. Sort: `created` -> created_at desc; `lastseen` -> last_active_at desc; anything else INCLUDING the documented default `mrr` -> id desc (QUIRK: MRR sort is not implemented; the `<select>` labels the default "ID"). Paginated 12 per page with query string preserved.
  3. QUIRK (plan storage mismatch): plan name/MRR are looked up by numeric package id (`packages.id`), but workspaces created by registration store the package SLUG (`workspaces.plan='starter'`), so they render as "Free" with MRR 0 and are missed by the plan filter and MRR sum; only checkout- or admin-assigned (numeric id) workspaces show real plan data.
  4. Row decoration: plan name (package `pname`, else "Free"), tone by name substring (enterprise blue, pro purple, growth/standard green, starter/basic amber, trial/other neutral), MRR = `package->chargeableAmount()` (offer price when set), `msgs7d` = outbound `messages` in the last 7 days, expiry = trial_ends_at for free/no plan else plan_ends_at, `expiry_days = ceil(seconds/86400)` (negative = expired), `is_trial` when free and trial_ends_at set.
  5. Health (from 7-day outbound volume): suspended -> "Suspended"; >= 500 "Good"; >= 50 "Active"; > 0 "Low"; 0 and created within 7 days "New"; else "Idle". (Docs describe Good/Watch/Risk; the code labels are these.)
  6. KPI stats: total, active (`status=1`), suspended (`status=0`), thisMonth (created since start of month), trial (workspaces on a free package or with no plan), MRR = sum of effective price of workspaces whose `plan` equals a paid, active package id (join on numeric id), formatted with the platform currency symbol and k/M abbreviation, retention = active/total %.
  7. Soft-deleted workspaces are excluded everywhere (default scope) and there is no trash listing.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** admin currency formatting (`FormatSettings`).
- **Acceptance criteria:**
  - Given 30 workspaces, When an admin opens the list, Then 12 rows show with pagination and KPIs.
  - Given a search "acme", Then only workspaces whose name/slug or owner name/email contain it appear.
  - Given filter status=suspended, Then only `status=0` workspaces show and the pill shows the count.
  - Given a workspace created 2 days ago with no sends, Then its health badge reads "New"; with 600 outbound messages in 7 days "Good".
  - Given a non-admin user, When they open `/admin/workspaces`, Then 403 "Admins only."
- **Source refs:** `app/Http/Controllers/Admin/WorkspacesController.php` (index, stats, health, planTone), `resources/views/admin/workspaces/index.blade.php`, `resources/js/charts/workspaces-index.js`, `routes/admin.php`, `Documentation/pages/admin-panel/workspaces.html`.
- **Port notes:** admin console app (`apps/web` admin area or a separate admin app) reading across orgs using a privileged DB role that bypasses RLS explicitly and audits reads; compute MRR from subscription rows not package lookups; implement the sort options the UI advertises; store plan as an FK so the slug-vs-id mismatch cannot occur.

### TW-WSP-024 — Admin: create workspace on behalf of a customer

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WSP-004, TW-WSP-030
- **Summary:** A platform admin provisions a workspace for a customer: name, slug, optional custom domain, an owner (pick an existing user or invite a new one by email), plan, billing cycle, profile fields and internal notes.
- **Actors & access:** admin group (see TW-WSP-023).
- **UX & screens:** `resources/views/admin/workspaces/create.blade.php` + `resources/js/charts/admin-workspaces-form.js` (Tom Select country and timezone pickers, owner-mode toggle, DNS help modal). Sections: **Workspace basics** - name (required), URL slug (auto from name when blank; hint shows `.<app host>` "default subdomain"), custom domain (with "How do I connect a custom domain?" modal listing a CNAME to `cnames.<host>` and an A record option), industry select (Retail - D2C, Healthcare, Food & delivery, Education, Real estate, Finance, SaaS, Logistics, Other), country (ISO code via country-state-city), timezone (default Asia/Kolkata), workspace logo upload block. **Owner & plan** - radio "Existing user" (select of all users `name - email`) vs "Invite by email" (owner name + email; copy: "We'll create the user, generate a random password, and email them a magic-link login. They'll be asked to set a new password on first sign-in."), plan radio cards (Free/no plan "$0" plus each package with price/unit and bullets `N msgs/mo`, `N devices`, `N users`), billing cycle select (monthly, quarterly, annual "15% off", custom, trial). **Limits & admin overrides** - monthly cap, daily cap, max devices, max users, three toggles (Skip onboarding email, Bill to platform credit, Pre-seed sample data default ON), admin note (max 2000). Footer warning: "creating a workspace bills the owner from day 1 unless billing cycle is Trial". Errors listed on top.
- **Endpoints:**

  | Endpoint                    | Route name              | Action                            | Middleware  | Request   | Response                                                   |
  | --------------------------- | ----------------------- | --------------------------------- | ----------- | --------- | ---------------------------------------------------------- |
  | GET admin/workspaces/create | admin.workspaces.create | Admin\WorkspacesController@create | admin group | -         | form (users list, plans)                                   |
  | POST admin/workspaces       | admin.workspaces.store  | Admin\WorkspacesController@store  | admin group | see rules | redirect to `admin.workspaces.detail` with `success` flash |

- **Data:** writes `workspaces` (name, slug, custom_domain, owner_user_id, plan, industry, country, timezone, currency, billing_cycle, cap_*, three booleans, admin_note, status=1, last_active_at), maybe `users` (invite mode: name, email, random 16-char password hashed, `role='owner'`, `email_verified_at` NULL, `force_password_change` true, `welcome_email_sent_at`), `password_reset_tokens`, `users.current_workspace_id` of the owner if empty, `audit_logs` (`admin.workspace.created` meta plan/owner_mode/owner_id/custom_domain).
- **Rules & edge cases:**
  1. Validation: `name` required max 120; `slug` nullable max 120 regex `^[a-z0-9-]*$` (case-insensitive) unique in workspaces; `custom_domain` nullable max 191 regex `^[a-z0-9.-]+\.[a-z]{2,}$` unique; `owner_user_id` required+exists in existing mode, nullable in invite mode; `plan` nullable and must exist in `packages.id`; `plan_ends_at` nullable date after today (ignored on create); `industry` max 80; `country` max 8; `timezone` max 64; `currency` max 8; `billing_cycle` in monthly|quarterly|annual|custom|trial; `cap_monthly_messages` int 0..1,000,000,000; `cap_daily_messages` 0..100,000,000; `cap_devices` and `cap_users` 0..10,000; `admin_note` max 2000. Invite mode additionally: `invite_email` required email max 191 unique in `users`, `invite_name` required max 120.
  2. Empty slug -> `Str::slug(name . '-' . Str::random(4))` (note: not `generateSlug`, so no `-2` suffix logic).
  3. Invite mode: user created first (role column `owner`, unverified, forced-password-change flag set - the flag is never enforced, see TW-WSP-047), then a password-reset token is generated and `AdminWelcomeMail` (login URL, reset URL, plaintext password) is sent only if mail is usable: a default mailer set, `from.address` set and not `hello@example.com`, and for smtp a host and port. Errors map to notices: "no mailer configured.", "sender address not set.", "SMTP host/port not set.", "SMTP authentication failed.", "SMTP connection refused.", "SMTP server timed out.", "mail transport error." The workspace is still created; flash "Workspace created. Owner created - invite email skipped: <reason>" or "... Invite email sent to <email>."
  4. QUIRK (owner not a member): the owner is only stored in `owner_user_id`; NO `workspace_user` row is created (only `users.current_workspace_id` is set when empty). The owner therefore has no workspace role (`workspaceRole()` null): role-gated pages redirect them to `/team-inbox`, the workspace is missing from their switcher, and permission checks fail, until a pivot row is inserted. Only admin-owned auto workspaces (TW-WSP-034) and onboarding paths create the pivot. Verify live and fix in the port.
  5. QUIRK (NOT NULL plan): the column `workspaces.plan` is `NOT NULL DEFAULT 'starter'` but the controller writes `null` when no plan is chosen ("Free / no plan" radio), which errors under strict SQL modes; verify live.
  6. Values stored as posted: `plan` = numeric package id (validated against `packages.id`), unlike signup which stores the slug. Creating with a paid plan does NOT set `plan_ends_at` or clear `trial_ends_at` (only the edit flow does, TW-WSP-026) and there is no trial start; `billing_cycle` is stored verbatim.
  7. UI-only or ignored: the logo upload has no backend, "Annual (15% off)" is only a label, the billing warning copy does not correspond to any billing action, the DNS modal's `cnames.<host>` target differs from what verification actually checks (`storefront.cname_target` else the app host), and the flashed session key `dns_setup_for` is never consumed by any view (no post-create DNS modal).
  8. Custom domain is stored unverified (`cname_verified` default 0); see TW-WSP-030.
  9. Starter tags, audit `workspace.created` and notification hooks fire (TW-WSP-004).
- **Async & events:** synchronous mail; audit row.
- **External systems:** mailer; DNS not touched at creation.
- **Settings:** mail config; `storefront.cname_target`.
- **Acceptance criteria:**
  - Given an admin choosing "Existing user" and a valid name, When they submit, Then a workspace with a unique slug exists, `owner_user_id` set, status active and they are redirected to its detail page with "Workspace created."
  - Given "Invite by email" with a new email, Then a user is created with role `owner`, an `AdminWelcomeMail` is sent when mail is configured, otherwise the flash reads "Owner created - invite email skipped: <reason>".
  - Given a slug or custom domain already in use, Then validation errors and no rows are created.
  - Given an invalid domain like `not a domain`, Then the regex error shows.
  - Given a non-admin, Then 403.
- **Source refs:** `app/Http/Controllers/Admin/WorkspacesController.php` (create, store, sendInviteEmail, validatePayload), `app/Mail/AdminWelcomeMail.php`, `resources/views/emails/admin-welcome.blade.php`, `resources/views/admin/workspaces/create.blade.php`, `resources/js/charts/admin-workspaces-form.js`, `Documentation/pages/admin-panel/workspaces.html`.
- **Port notes:** target admin flow = create org + create/invite owner user + assign owner role in one transaction; always create the membership. Send invite via outbox with token link. Store plan as FK; validate custom domain against the tenant-domain table.

### TW-WSP-025 — Admin: workspace detail dashboard

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M
- **Depends on:** TW-WSP-010
- **Summary:** One screen per workspace for support and sales: identity, owner, plan, MRR/LTV, 30-day message volume chart, delivery and read rates, resource counts, effective limit usage bars, recent orders, custom-domain panel and the inline edit form.
- **Actors & access:** admin group. (Note: `AdminPagesController@workspaceDetail` is an older prototype action that is not routed; the routed action is `Admin\WorkspacesController@detail`.)
- **UX & screens:** `resources/views/admin/workspaces/detail.blade.php` (page key `admin-workspaces-detail`, JS `resources/js/charts/admin-workspaces-detail.js`: ApexCharts area chart Sent vs Delivered, edit-panel toggle, opens the edit panel when `?edit=1`, `#edit-panel`, or a validation error is present). Header actions: Login as owner (prompt reason), Suspend/Reactivate, Edit. Hero: id padded to 4 digits, created date, name, slug, custom-domain chip with verified/pending state, industry, country/timezone, "N users - N devices", owner name, MRR, LTV, Health. Custom-domain panel: when verified "Domain live - the shop serves on <domain>" with Re-check; when pending DNS instructions (CNAME -> target, and an A record to the resolved IP for apex domains) and a "Verify now" button. Six KPI cards: Sent (30d) with % of cap or "no cap", Delivered %, Read rate %, Campaigns (+broadcasts), Devices `n / limit`, Contacts. Plan usage bars (messages 30d, devices, users, contacts vs `monthly_messages_limit`, `device_limit`, `user_seat_limit`, `contacts_limit`; bar tone coral > 80%, amber > 50%; unlimited shows "infinity"). Recent orders (last 6: order number, plan name, amount in the order's currency, status chip paid/pending/failed/refunded, relative time; empty "No orders yet."). Owner block (name, email, masked mobile, link to owner profile edit). Admin note. Collapsible "Edit workspace" form (TW-WSP-026) and Danger zone (Suspend/Reactivate, Move to trash "Recoverable for 30 days").
- **Endpoints:**

  | Endpoint                  | Route name              | Action                            | Middleware  | Request | Response |
  | ------------------------- | ----------------------- | --------------------------------- | ----------- | ------- | -------- |
  | GET admin/workspaces/{id} | admin.workspaces.detail | Admin\WorkspacesController@detail | admin group | path id | HTML     |

- **Data:** reads `workspaces`, `packages`, `messages` (30-day daily sums of outbound and outbound delivered|read; a separate count of `read`), `devices` (via `Device::forWorkspace(ws, owner)` including legacy NULL-workspace devices of the owner; falls back to a raw count), `campaigns`, `broadcasts`, `contacts` (each guarded with `Schema::hasTable/hasColumn`), `users` (count where `current_workspace_id = ws`, NOT via the pivot), `orders`.
- **Rules & edge cases:**
  1. Chart buckets: every day from start-of-day 30 days ago to end-of-today; `sent` counts outbound rows, `delivered` counts outbound with status delivered or read. `deliveredPct = delivered/sent*100` (1 decimal), `readPct = read/sent*100`.
  2. MRR = package `chargeableAmount()`; LTV = MRR x max(1, whole months since creation) (a rough proxy).
  3. Effective limits are computed for every column in `AdminPagesController::PLAN_LIMIT_COLUMNS` (plus extension limits) via `Workspace::effectiveLimit` so overrides and add-ons show.
  4. Health uses the same thresholds as the list but fed the 30-DAY sent total (QUIRK: list uses 7 days, detail 30 days, so the same workspace can show different badges).
  5. `package` is looked up by numeric id only (`Package::find(plan)`) so slug-stored plans show no package/`Free` (see TW-WSP-023 rule 3).
  6. The "users" count and usage bar count users whose `current_workspace_id` is this workspace, which is not the member count (a member currently standing in another workspace is not counted).
  7. Missing tables/columns count as 0 (guard for optional modules).
- **Async & events:** none.
- **External systems:** DNS `gethostbyname` for the apex A-record hint.
- **Settings:** `config('storefront.cname_target')`.
- **Acceptance criteria:**
  - Given a workspace with 100 sent and 90 delivered messages in 30 days, Then Delivered shows 90.0% and the chart has 31 daily points.
  - Given `plan_overrides = {device_limit: 10}`, Then the Devices bar denominator is 10.
  - Given `?edit=1`, Then the edit panel opens on load.
  - Given an unknown id, Then 404.
- **Source refs:** `app/Http/Controllers/Admin/WorkspacesController.php` (detail, safeCount, health), `resources/views/admin/workspaces/detail.blade.php`, `resources/js/charts/admin-workspaces-detail.js`, `resources/js/charts/workspaces-detail.js`, `app/Http/Controllers/AdminPagesController.php`.
- **Port notes:** build with pre-aggregated analytics (DASH domain rollups) instead of live `GROUP BY` over the messages table; count members from the membership table.

### TW-WSP-026 — Admin: edit workspace (plan grant, owner, slug, caps)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WSP-010
- **Summary:** Admins edit a workspace's profile, owner, slug, custom domain, plan and admin notes. Assigning a different plan activates it immediately (lifts the trial gate, stamps a valid-until date) the same way a purchase would.
- **Actors & access:** admin group.
- **UX & screens:** the collapsible edit panel on the detail page: Name, Slug, Custom domain (with DNS hint "CNAME -> target - A -> ip"), Owner select (all users), Plan select ("No plan / Free" or each package with its effective price in the package currency; current value matched by numeric id OR slug), "Plan valid until" date, Billing cycle (Monthly/Quarterly/Annual/Custom/Trial), Industry, Country (ISO-2), Timezone (searchable), Currency, four cap inputs (placeholders "inherit"), Admin note. Hints: "Changing the plan activates it immediately and clears any expired trial." and "Leave blank to use the plan's own billing cycle. Only applied when the plan changes."
- **Endpoints:**

  | Endpoint                  | Route name              | Action                            | Middleware  | Request                                     | Response                                 |
  | ------------------------- | ----------------------- | --------------------------------- | ----------- | ------------------------------------------- | ---------------------------------------- |
  | PUT admin/workspaces/{id} | admin.workspaces.update | Admin\WorkspacesController@update | admin group | fields as create (unique rules ignore self) | back with `success` "Workspace updated." |

- **Data:** updates `workspaces`; audit `admin.workspace.updated` meta `{plan_changed:{from,to}|null, owner_changed:{from,to}|null}` plus the observer's `workspace.updated`.
- **Rules & edge cases:**
  1. Same validation as TW-WSP-024 with slug/domain uniqueness ignoring this workspace.
  2. Slug on rename: if the name changed AND the submitted slug equals the stored slug AND the stored slug "looks derived" from the OLD name (equals `Str::slug(oldName)` or `<that>-<digits>`), the slug is regenerated with `generateSlug(newName)`. A hand-typed/edited slug is left as submitted; blank submitted slug keeps the old one. (Reason: workspaces first named "Admin's workspace" kept `admins-workspace` forever after rename.)
  3. Plan change (compare old vs new stored value, so switching between the slug and id forms of the same plan counts as a change): sets `trial_ends_at = NULL` and `plan_ends_at` = the given date (end of that day, must be after today) when the package is paid (not free, lifetime or custom-quote), else derived from the package cycle: `plan_duration` (min 1) x `plan_unit` normalised by trimming a trailing "s" and lower-casing (`day`, `week`, `year`, anything else = months; seeded data mixes `days`, `month`, `months`); free/lifetime/custom-quote/no plan -> `plan_ends_at = NULL` (never expires).
  4. Same plan + `plan_ends_at` supplied: corrects the renewal date in place (end of that day) and clears `trial_ends_at`; re-saving without a date never touches the billing window.
  5. Fields absent from the post are nulled (industry, country, custom_domain, caps, admin_note, plan) except timezone/currency/billing_cycle/owner which keep old values when omitted. The form always posts everything.
  6. QUIRK: changing `custom_domain` does not reset `cname_verified`; an old verified flag persists for the NEW domain until someone re-verifies (or a domain swap silently serves the new host as verified). Fix in port: reset verification on change.
  7. QUIRK: changing `owner_user_id` only updates the column - the pivot roles are not adjusted (new owner may not be a member; old owner keeps the `owner` pivot role).
  8. QUIRK: `plan` is stored as the numeric package id string here vs slug at signup (see Open questions); `billing_cycle` is not changed by a plan change.
  9. Validation failure re-opens the edit panel with errors.
- **Async & events:** audit rows; no notification/email to the owner about the plan change.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a workspace on a lapsed trial, When an admin assigns a paid monthly plan (no date), Then `trial_ends_at` is NULL and `plan_ends_at` = now + package duration, and the customer is no longer trial-locked.
  - Given the same plan and a supplied `plan_ends_at` 2026-12-31, Then `plan_ends_at` = end of that day and other fields unchanged.
  - Given a workspace renamed from "Acme" to "Acme Corp" with an untouched auto slug `acme`, Then the slug becomes `acme-corp`; with a custom slug `acme-sales` it stays.
  - Given a duplicate slug or domain, Then a validation error and no change.
  - Given the plan is switched to Free, Then `plan_ends_at` is NULL.
- **Source refs:** `app/Http/Controllers/Admin/WorkspacesController.php` (update, slugLooksDerivedFrom, validatePayload), `resources/views/admin/workspaces/detail.blade.php`, `app/Models/Package.php`, `Documentation/pages/admin-panel/workspaces.html`.
- **Port notes:** implement `AdminChangePlan` as the same command checkout uses (single code path for trial/expiry stamping) and emit `workspace.plan_changed` on the outbox so notifications/entitlement caches update.

### TW-WSP-027 — Admin: suspend / reactivate toggle

- **Status:** partial
- **Priority:** P0 (product unusable without)
- **Effort:** S
- **Depends on:** TW-WSP-014
- **Summary:** Admins flip a workspace between active and suspended from the list row menu or the detail page. In v1.7.0 the flag is recorded and audited but nothing on the customer side enforces it.
- **Actors & access:** admin group (no dedicated Spatie permission check; contrast TW-WSP-028 which checks `platform.workspace.suspend`).
- **UX & screens:** "Suspend"/"Reactivate" in the row menu, the detail header and the Danger zone ("Owner can still log in but all dashboards lock until reactivated"); suspended rows show a red badge/tint and a "Suspended" health label.
- **Endpoints:**

  | Endpoint                          | Route name              | Action                                  | Middleware  | Request | Response                                                    |
  | --------------------------------- | ----------------------- | --------------------------------------- | ----------- | ------- | ----------------------------------------------------------- |
  | POST admin/workspaces/{id}/toggle | admin.workspaces.toggle | Admin\WorkspacesController@toggleStatus | admin group | -       | back with "Workspace suspended." / "Workspace reactivated." |

- **Data:** flips `workspaces.status`; audit `admin.workspace.suspended` / `admin.workspace.reactivated` (+ observer `workspace.updated`).
- **Rules & edge cases:**
  1. No reason capture, no confirmation dialog, no owner notification, no flag row (unlike TW-WSP-028). The two suspension paths are independent: toggling `status` back on does not clear a `frozen` flag written by TW-WSP-028, and clearing via TW-WSP-028 restores `status` but not other flags.
  2. Enforcement gap: the only code that blocks a suspended workspace is the unattached `EnsureWorkspaceMembership` (TW-WSP-014); `ImpersonationBanner`, trial gating and plan guards ignore `status`. Only list health/badges and KPI counts react. Confirm live before deciding parity.
  3. Suspending does not stop background work (campaign runners, Node sockets, schedules) - nothing checks `workspaces.status`.
- **Async & events:** audit rows only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active workspace, When an admin posts toggle, Then `status=0`, audit `admin.workspace.suspended` exists and the list shows the Suspended badge; posting again reactivates.
  - Given a non-admin, Then 403.
  - (Port target, intended) Given a suspended workspace, Then its members are blocked (see TW-WSP-014 acceptance).
- **Source refs:** `app/Http/Controllers/Admin/WorkspacesController.php` (toggleStatus), `resources/views/admin/workspaces/index.blade.php`, `resources/views/admin/workspaces/detail.blade.php`.
- **Port notes:** unify with TW-WSP-028 into one `suspend(org, reason)` command that sets status + writes an audit + stops workers/webhook handlers for the org.

### TW-WSP-028 — Admin: suspend / unsuspend with frozen flag and trust-and-safety flags

- **Status:** partial
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** TW-WSP-014
- **Summary:** The platform team-inbox console (JSON endpoints under `admin/team-inbox/api`) can suspend a workspace with a reason (recording a `frozen` flag), unsuspend it, raise arbitrary trust-and-safety flags (spam, abuse, fraud, billing_overdue, tos_violation, frozen) and clear them. Used by platform support with granular Spatie permissions.
- **Actors & access:** admin group middleware plus per-action Spatie permission checks on the user: `platform.workspace.suspend`, `platform.workspace.unsuspend`, `platform.workspace.flag`, `platform.workspace.unflag` (403 without). Spatie roles Super Admin and Admin hold all; Platform Support holds flag/unflag only; Auditor none. (Because the whole group also needs `EnsureUserIsAdmin`, Platform Support users without the Admin role or legacy admin role column cannot reach these routes at all - see Open questions.)
- **UX & screens:** driven by `resources/views/admin/team-inbox/index.blade.php` and `resources/js/charts/admin-team-inbox-index.js` (ASHELL/TIB2 own the page); this feature covers only the workspace actions: suspend button with reason, flag dropdown, clear flag.
- **Endpoints:**

  | Endpoint                                            | Route name                      | Action                                            | Middleware  | Request             | Response     |
  | --------------------------------------------------- | ------------------------------- | ------------------------------------------------- | ----------- | ------------------- | ------------ |
  | POST admin/team-inbox/api/workspaces/{id}/flag      | admin.team-inbox.api.flag       | Admin\AdminTeamInboxController@flagWorkspace      | admin group | flag (enum), reason | `{ok, flag}` |
  | DELETE admin/team-inbox/api/flags/{id}              | admin.team-inbox.api.flag.clear | Admin\AdminTeamInboxController@clearFlag          | admin group | -                   | `{ok}`       |
  | POST admin/team-inbox/api/workspaces/{id}/suspend   | admin.team-inbox.api.suspend    | Admin\AdminTeamInboxController@suspendWorkspace   | admin group | reason              | `{ok}`       |
  | POST admin/team-inbox/api/workspaces/{id}/unsuspend | admin.team-inbox.api.unsuspend  | Admin\AdminTeamInboxController@unsuspendWorkspace | admin group | -                   | `{ok}`       |

- **Data:** `workspace_flags` (workspace_id, flag, reason max 500, flagged_by_user_id, cleared_at, cleared_by_user_id), `workspaces.status`, `audit_logs` via `AuditLogger::platform` (`workspace.flagged`, `workspace.unflagged`, `workspace.suspended`, `workspace.unsuspended`).
- **Rules & edge cases:**
  1. `flag` must be one of spam|abuse|fraud|billing_overdue|tos_violation|frozen; `reason` nullable max 500. Multiple flags per workspace are allowed and duplicates are not deduplicated. Flag on a non-existent workspace id is not validated (row inserted with that id).
  2. Suspend: sets `status=false` and inserts a `frozen` flag with the reason. Unsuspend: sets `status=true` and clears only uncleared `frozen` flags (`tos_violation` and `fraud` flags remain, and `Workspace::isSuspended()` treats frozen, tos_violation and fraud as suspending - so a workspace can remain "suspended" after unsuspend).
  3. `Workspace::isSuspended()` = any uncleared flag in {frozen, tos_violation, fraud}; `spam`, `abuse`, `billing_overdue` are informational.
  4. Enforcement gap identical to TW-WSP-027 (only the unattached membership middleware would enforce).
  5. Clearing a flag stamps `cleared_at` and `cleared_by_user_id`; there is no reopen.
- **Async & events:** audit rows (layer platform).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a Super Admin, When they POST suspend with a reason, Then `status=0`, an uncleared `frozen` flag with the reason exists, audit `workspace.suspended` is written.
  - Given a user without `platform.workspace.flag`, When they POST a flag, Then 403.
  - Given a `fraud` flag exists, When unsuspend is posted, Then `status=1` but the fraud flag stays and `isSuspended()` is still true.
  - Given an invalid flag value, Then 422.
- **Source refs:** `app/Http/Controllers/Admin/AdminTeamInboxController.php` (flagWorkspace, clearFlag, suspendWorkspace, unsuspendWorkspace), `app/Models/WorkspaceFlag.php`, `app/Support/PlatformPermissions.php`, `app/Services/Inbox/AuditLogger.php`, `routes/admin.php`.
- **Port notes:** model as `org_flags` table + org status; make "suspended" a derived, single-source-of-truth predicate enforced by the tenant guard.

### TW-WSP-029 — Admin: move workspace to trash

- **Status:** partial
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** -
- **Summary:** Admins soft-delete a workspace from the list row menu or detail Danger zone. UI copy promises recovery ("Recoverable for 30 days") but v1.7.0 has no trash list, restore route or auto-purge for workspaces.
- **Actors & access:** admin group.
- **UX & screens:** confirm modal "Move X to trash? Owner will be locked out until it's restored." (list) / "Recoverable for 30 days." (detail); on success redirect to the list with "Workspace moved to trash."
- **Endpoints:**

  | Endpoint                     | Route name               | Action                             | Middleware  | Request | Response                          |
  | ---------------------------- | ------------------------ | ---------------------------------- | ----------- | ------- | --------------------------------- |
  | DELETE admin/workspaces/{id} | admin.workspaces.destroy | Admin\WorkspacesController@destroy | admin group | -       | redirect `admin.workspaces.index` |

- **Data:** sets `workspaces.deleted_at`; audit `admin.workspace.trashed` meta `{id,name,slug}`; observer `workspace.deleted`.
- **Rules & edge cases:**
  1. Only the workspace row is soft-deleted; members, data, devices, Node sockets, campaigns keep existing and running. There is no restore endpoint/screen (only direct DB or tinker), no 30-day purge job (the automatic data wipe in TW-WSP-035 is retention-based and unrelated), and slug/domain uniqueness still holds for the trashed row (the DB unique index includes soft-deleted rows, so the slug/domain cannot be reused).
  2. Members of the trashed workspace lose it from switchers (default scope); users whose current pointer references it fall back to another workspace via the accessor.
- **Async & events:** audit rows.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active workspace, When an admin trashes it, Then `deleted_at` is set, it disappears from the admin list and members' switchers, and an audit row exists.
  - Given a trashed workspace's slug, When another workspace is created with that slug, Then the `unique:workspaces,slug` validation rule fails because it also counts soft-deleted rows.
- **Source refs:** `app/Http/Controllers/Admin/WorkspacesController.php` (destroy), `resources/views/admin/workspaces/index.blade.php`, `resources/views/admin/workspaces/detail.blade.php`.
- **Port notes:** implement soft delete with `deleted_at` plus a restore action and a retention purge worker (30 days), releasing slug/domain on purge; stop schedulers and provider webhooks for a trashed org.

### TW-WSP-030 — Admin: custom-domain DNS verification

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** TW-WSP-013
- **Summary:** After an admin sets a workspace's custom domain the detail page shows the DNS record to add; a "Verify now"/"Re-check" button looks up the CNAME and flips `cname_verified`, after which the domain resolves to the workspace (TW-WSP-013 and storefront).
- **Actors & access:** admin group.
- **UX & screens:** panel on the detail page (see TW-WSP-025); result flash: success "Domain verified - the shop now serves on <domain>." or error "CNAME not found yet. Point <domain> -> <expected> (CNAME), then verify again."; if no domain set: error "No custom domain set for this workspace."
- **Endpoints:**

  | Endpoint                                 | Route name                     | Action                                  | Middleware  | Request | Response        |
  | ---------------------------------------- | ------------------------------ | --------------------------------------- | ----------- | ------- | --------------- |
  | POST admin/workspaces/{id}/verify-domain | admin.workspaces.verify-domain | Admin\WorkspacesController@verifyDomain | admin group | -       | back with flash |

- **Data:** writes `workspaces.cname_verified`; audit `admin.workspace.domain_verify` meta `{domain, verified}`.
- **Rules & edge cases:**
  1. Expected target = `config('storefront.cname_target')` else host of `APP_URL` else `localhost`. Lookup = PHP `dns_get_record(domain, DNS_CNAME)` (errors suppressed); verified if ANY record's `target` contains the expected string case-insensitively (substring match, not equality - QUIRK: `expected.evil.com` would pass).
  2. Only CNAME is examined: an apex domain configured with the A record the panel recommends can never verify (QUIRK).
  3. Re-checking a verified domain whose CNAME was removed flips it back to unverified.
  4. No throttle, no ownership challenge (TXT), no TLS provisioning.
- **Async & events:** audit row.
- **External systems:** DNS resolver of the app server.
- **Settings:** `storefront.cname_target` (config/storefront.php), `APP_URL`.
- **Acceptance criteria:**
  - Given a domain whose CNAME points at the platform host, When verify is posted, Then `cname_verified=1` and the success flash appears.
  - Given no CNAME, Then `cname_verified=0` and the error flash names the expected target.
  - Given the workspace has no domain, Then error "No custom domain set for this workspace."
- **Source refs:** `app/Http/Controllers/Admin/WorkspacesController.php` (verifyDomain), `config/storefront.php`, `resources/views/admin/workspaces/detail.blade.php`.
- **Port notes:** use a verification token (TXT record or `_acme-challenge` CNAME) plus exact CNAME target match; run as a worker job with retries and status polling; support apex via A/ALIAS records; automate certificates.

### TW-WSP-031 — Admin: per-workspace plan limit overrides

- **Status:** partial
- **Priority:** P2 (nice to have)
- **Effort:** S
- **Depends on:** TW-WSP-010
- **Summary:** A backend endpoint stores per-workspace overrides for any numeric plan limit (`-1` = unlimited) in `workspaces.plan_overrides`, which `effectiveLimit()` honours before the package value. Docs describe entering them on the detail page; no view in v1.7.0 posts to this route.
- **Actors & access:** admin group.
- **UX & screens:** none found (grep of `resources/views` and `resources/js` shows no form/JS calling `admin.workspaces.overrides`); the detail page only DISPLAYS effective limits. Marked partial because the storage, validation and consumption exist but no screen.
- **Endpoints:**

  | Endpoint                             | Route name                 | Action                                      | Middleware  | Request                       | Response                          |
  | ------------------------------------ | -------------------------- | ------------------------------------------- | ----------- | ----------------------------- | --------------------------------- |
  | POST admin/workspaces/{id}/overrides | admin.workspaces.overrides | AdminPagesController@workspaceSaveOverrides | admin group | `overrides[<limit_key>]` ints | back with "Plan overrides saved." |

- **Data:** `workspaces.plan_overrides` JSON object `{key: int}`.
- **Rules & edge cases:**
  1. Accepted keys = `AdminPagesController::planLimitColumns()` = the `PLAN_LIMIT_COLUMNS` list (device_limit, monthly_messages_limit, contacts_limit, broadcast_limit, template_limit, groups_limit, campaign_messages_limit, automation_messages_limit, broadcast_size_limit, total_campaigns_limit, active_campaign_limit, user_seat_limit, tags_limit, flow_limit, flow_steps_limit, autoreply_limit, chatbot_limit, scheduled_campaign_limit, daily_media_size_allowance, workspaces_per_owner_limit, routing_rules_limit, drip_campaigns_limit, appointments_limit, ai_agents_limit, saved_replies_limit, webhooks_limit, ai_token_limit_monthly, waba_calling_minutes_monthly, ai_voice_minutes_monthly, ai_chat_messages_monthly, ai_training_sources_limit, chatbot_widgets_limit, storefronts_limit, sla_policies_limit, translation_chars_monthly, api_rate_limit_per_minute, sms_monthly_limit, email_monthly_limit) plus limits registered by extensions.
  2. Each value nullable integer min -1 max 10,000,000; blanks/nulls are dropped; the remaining are cast to int; an empty result stores NULL. Feature toggles (booleans) cannot be overridden through this endpoint even though `effectiveLimit` would honour a boolean key.
  3. No audit entry is written by this action (the model observer records a generic `workspace.updated` change).
  4. Consumers treat 0 or negative as unlimited (TW-WSP-010 rule 4), so an override of `0` means unlimited, not zero.
- **Async & events:** observer audit only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `overrides[device_limit]=5` and other fields blank, When posted, Then `plan_overrides = {"device_limit":5}` and `effectiveLimit('device_limit')` = 5.
  - Given all fields blank, Then `plan_overrides` is NULL.
  - Given `overrides[device_limit]=abc` or `-2`, Then validation fails.
- **Source refs:** `app/Http/Controllers/AdminPagesController.php` (workspaceSaveOverrides, PLAN_LIMIT_COLUMNS, planLimitColumns), `app/Models/Workspace.php` (effectiveLimit), `Documentation/pages/admin-panel/workspaces.html`.
- **Port notes:** build the missing UI (limits table with "inherit" placeholder + "unlimited" toggle) and audit each change with before/after; allow feature-flag overrides.

### TW-WSP-032 — Impersonation: start session

- **Status:** implemented
- **Port status:** built as an act-as session (ADR-0020): `POST /v2/platform/workspaces/:id/impersonate` (permission + super admin) returns a one-time handoff URL; the web `/impersonate` route redeems it for an access-only token with no refresh. One open session per operator, 60 minute cap, optional read-only mode (added, not in Reference), owner-only routes refused, both actors audited. The Admin Team Inbox launcher (`platform/inbox/workspaces/:id/impersonate`) starts the same session (writes allowed). Not ported: "Login as user" on the Users row (no user-level start yet).
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WSP-012
- **Summary:** A platform admin with the impersonate permission chooses "Login as owner" on a workspace (or "Login as user" on a user row, which impersonates that user's current workspace), gives a reason (>= 8 characters) and is dropped into `/team-inbox` viewing that workspace as its owner. Every session is recorded for audit.
- **Actors & access:** admin group middleware AND Spatie permission `platform.workspace.impersonate` (Super Admin, Admin and Platform Support hold it; Manager/User/Auditor do not - but the group-level admin gate means Platform Support alone cannot reach the route, see Open questions) else 403. No impersonation of suspended workspaces is blocked; no restriction on impersonating another platform admin's private workspace.
- **UX & screens:** buttons in Admin > Workspaces list menu, workspace detail header, Admin > Users row (icon and menu; disabled/"Unavailable" for suspended users or users without a current workspace) and the admin Team Inbox modal. All are POST forms carrying `data-prompt-reason` ("Reason for impersonating <workspace>? This is logged for audit.", title "Login as owner", placeholder "e.g. troubleshooting ticket #1234", `data-min-length=8`); `resources/js/lib/ui-modal.js` shows a prompt, injects the reason into a hidden `reason` input and submits.
- **Endpoints:**

  | Endpoint                             | Route name              | Action                              | Middleware  | Request | Response                                                          |
  | ------------------------------------ | ----------------------- | ----------------------------------- | ----------- | ------- | ----------------------------------------------------------------- |
  | POST admin/impersonate/{workspaceId} | admin.impersonate.start | Admin\ImpersonationController@start | admin group | reason  | redirect `/team-inbox` with success "Now viewing as <workspace>." |

- **Data:** inserts `impersonation_sessions` (admin_user_id, target_workspace_id, original_workspace_id = the admin's persisted `current_workspace_id`, reason, ip, user_agent truncated to 500, started_at); closes any other OPEN session of this admin (`ended_at = now`); session key `impersonation_session_id` on the admin's browser session; audit `impersonation.started` (layer platform) with `{reason, session_id}`.
- **Rules & edge cases:**
  1. Validation: `reason` required string min 8 max 500. Unknown workspace -> 404 (route `whereNumber`).
  2. One open session per admin: starting a new one silently ends the previous (even one running in another tab/device of the same account; that other browser then finds its session closed and reverts to its own workspace on the next request).
  3. The impersonation is bound to THIS browser session via the session key, not to the account - a second tab/device/admin signed into the same account is not affected (this fixed a hijack where impersonation flipped everyone's screen).
  4. No persistence to the admin's user row (see TW-WSP-033); the redirect goes to `/team-inbox` (the customer's inbox), not the dashboard.
  5. Actions performed while impersonating are attributed to the admin's own user id in `audit_logs.actor_user_id` and rely on the workspace stamp for grouping (used by the stop-summary).
- **Async & events:** audit row; no notification to the customer.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an admin with `platform.workspace.impersonate`, When they POST start with reason "Ticket 1234 debug", Then an `impersonation_sessions` row with null `ended_at` exists, the browser session has the key and they land on `/team-inbox` with "Now viewing as <ws>."
  - Given a reason shorter than 8 characters, Then validation error and no session.
  - Given a user lacking the permission, Then 403.
  - Given the admin already has an open session, When they start another, Then the first gets `ended_at`.
- **Source refs:** `app/Http/Controllers/Admin/ImpersonationController.php` (start), `app/Models/ImpersonationSession.php`, `app/Support/PlatformPermissions.php`, `resources/js/lib/ui-modal.js`, `resources/views/admin/workspaces/index.blade.php`, `resources/views/admin/users/index.blade.php`, `resources/views/admin/team-inbox/index.blade.php`, `Documentation/pages/admin-panel/workspaces.html`.
- **Port notes:** mint an impersonation token (`act_as_org`, `actor_admin_id`, `reason`, short TTL, session id) rather than a session key; RLS policy uses the acting org; every write during impersonation gets both actor ids in the audit row. Require step-up auth for impersonation and notify the org owner optionally.

### TW-WSP-033 — Impersonation: banner, scoping, effective Owner grant and stop

- **Status:** implemented
- **Port status:** built (ADR-0020): `GET /v2/auth/impersonation` feeds a non-dismissible amber banner (workspace, owner, reason, time left, read-only badge, Stop) in the workspace app; `POST /v2/auth/impersonation/stop` ends the session at once (Redis tombstone), writes `platform.impersonation.stopped` with duration and per-action counts, and the web route clears the cookie and returns to `/admin/workspaces`. Differences from Reference on purpose: the act-as token never edits the operator's session, expires in at most 60 minutes, can be read-only, and is refused password, 2FA, email, sessions, API keys and `/v2/platform/*` (`WSP_IMPERSONATION_FORBIDDEN`). Losing the permission closes the session on the next request (operator must stay active super admin).
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WSP-032
- **Summary:** While a session is open a sticky amber banner shows the workspace and reason with a "Stop impersonating" button; the admin runs the customer's workspace with full Owner capabilities; stopping ends the session, logs an activity summary and restores the admin's own workspace.
- **Actors & access:** middleware `ImpersonationBanner` (global `web` group); stop route in the admin group (admin + IP allow-list).
- **UX & screens:** banner in `resources/views/components/layouts/user.blade.php`: "IMPERSONATING", workspace name, "- <reason>" (hidden on small screens) and a POST form to `/admin/impersonate/stop`. `impersonation` view variable is shared only when active.
- **Endpoints:**

  | Endpoint                    | Route name             | Action                             | Middleware  | Request | Response                                                                                      |
  | --------------------------- | ---------------------- | ---------------------------------- | ----------- | ------- | --------------------------------------------------------------------------------------------- |
  | POST admin/impersonate/stop | admin.impersonate.stop | Admin\ImpersonationController@stop | admin group | -       | redirect `/admin/team-inbox` with "Impersonation stopped." (or silent redirect if no session) |

- **Data:** `impersonation_sessions.ended_at`; `users.current_workspace_id` (restored); audit `impersonation.stopped` payload `{session_id, duration_seconds, total_events, events_by_action, events_by_module}`.
- **Rules & edge cases:**
  1. Per request: skipped before install; no user -> pass; no `impersonation_session_id` in the session -> `impersonation=null` (the admin sees their own workspace); key present but session missing/closed -> key forgotten, no banner.
  2. Live re-check each request: if the admin no longer holds `platform.workspace.impersonate` the session is force-closed and they fall back to normal.
  3. Scoping: `current_workspace_id` is overridden IN MEMORY to the target and re-baselined as clean (`syncOriginalAttribute`) so no later `save()` persists it (fixes the "impersonated workspace got assigned to me" leak).
  4. Effective Owner: `User::workspaceRole(target)` returns `owner` for an admin whose browser session holds an active session for that target (no pivot row needed), so `WorkspacePermissions` allow everything an Owner can (invite members, edit settings, etc.); the grant is scoped strictly to the target and this session.
  5. Membership guard exemption: `EnsureWorkspaceMembership` (unwired) explicitly allows active impersonation targets; `WorkspaceEngine::orphanPairerUserId()` returns 0 while impersonating so the admin's own NULL-workspace devices don't leak into the customer's sender lists.
  6. Stop: reads and clears the session key (falls back to the admin's latest open session), sets `ended_at`, aggregates `audit_logs` rows by this actor in the target workspace between started_at and ended_at grouped by `action` (top 50 by count) and module (first dotted segment), writes `impersonation.stopped`, then restores `current_workspace_id` to `original_workspace_id` if the admin is still a member of it, else if the stored pointer equals the target picks `workspaces()->first()`.
  7. A stop with no session redirects to `/admin/team-inbox` without a flash.
  8. Restrictions NOT present: no read-only mode, no time limit, no block on sending customer messages, changing billing or removing members; the banner text is the only guard rail.
- **Async & events:** audit rows; realtime not affected.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active session, When the admin loads `/team-inbox`, Then data is the target workspace's, the banner shows the reason, and `users.current_workspace_id` in the DB is unchanged.
  - Given an active session and the admin invites a member, Then it succeeds as Owner and audit rows carry the admin's id.
  - Given the admin's permission is revoked mid-session, Then the next request closes the session and shows their own workspace.
  - Given the admin posts stop, Then `ended_at` is set, `impersonation.stopped` audit contains duration and per-action counts, and they land on `/admin/team-inbox`.
  - Given a second browser signed into the same admin account, Then it shows no banner and its own workspace.
- **Source refs:** `app/Http/Middleware/ImpersonationBanner.php`, `app/Http/Controllers/Admin/ImpersonationController.php` (stop), `app/Models/User.php` (workspaceRole, isImpersonatingWorkspace), `app/Models/ImpersonationSession.php`, `app/Services/WorkspaceEngine.php`, `resources/views/components/layouts/user.blade.php`.
- **Port notes:** `impersonation_sessions` becomes a platform-level (non-RLS) audit table; the guard resolves the act-as claim; keep the exit summary as an audit-service query. Consider adding a read-only mode and mandatory expiry (not in Reference).

### TW-WSP-034 — Private admin workspace auto-provisioning

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** -
- **Summary:** Every platform admin gets a private, admin-owned workspace so their session has a scope that does not bleed customer data. It is created (idempotently) on each login of an admin.
- **Actors & access:** triggered by the `Illuminate\Auth\Events\Login` listener in `AppServiceProvider`; only for admins (Spatie role Super Admin/Admin, legacy `users.role` in admin, super-admin, super_admin, platform-admin). Also runnable elsewhere (`AdminWorkspaceProvisioner::ensureFor`).
- **UX & screens:** none (the workspace is named "<name> Admin").
- **Endpoints:** none.
- **Data:** creates `workspaces` (name "<name> Admin", slug `slug(name-admin)-<first 6 hex of md5(user id)>`, owner, status 1, currency = setting `default_currency` else USD, timezone = setting `default_timezone` else app timezone, industry "Internal", admin_note explaining it) if the admin owns none; upserts the `workspace_user` pivot as `owner` with `joined_at = now`; sets `users.current_workspace_id`.
- **Rules & edge cases:**
  1. "Owns none": looks up ANY workspace owned by the user (not specifically a private one).
  2. Uses `updateOrInsert` because `workspace_user` historically had no unique constraint; the final schema has a unique (workspace_id, user_id) index.
  3. Current-workspace repair: if the admin has no current workspace, or the current one is not owned by them, it is set to their own workspace - so a deliberate admin switch to a workspace they belong to but do not own is undone at the next login (only "owned" counts).
  4. No plan is assigned (`plan` takes the column default `starter`); platform-admin-owned workspaces are unlimited anyway (`ownedByPlatformAdmin`, TW-WSP-010).
  5. Failures are caught and `error_log`ged so login is never blocked.
- **Async & events:** the workspace `created` hooks (starter tags, audit).
- **External systems:** none.
- **Settings:** `default_currency`, `default_timezone`.
- **Acceptance criteria:**
  - Given a Super Admin with no workspace, When they log in, Then a workspace "<name> Admin" exists with a pivot `owner` row and it is their current workspace; a second login creates nothing new.
  - Given a non-admin user, When they log in, Then nothing is provisioned.
  - Given the admin currently points at a customer's workspace they do not own, When they log in, Then the pointer moves to their own workspace.
- **Source refs:** `app/Support/AdminWorkspaceProvisioner.php`, `app/Providers/AppServiceProvider.php` (Login listener), `app/Models/Workspace.php`.
- **Port notes:** platform staff should be a separate identity type outside tenant orgs (no private org needed); if kept, seed it during first-run install (CORE) rather than on every login.

### TW-WSP-035 — Data-retention wipe (`workspaces:wipe-expired`)

- **Status:** partial
- **Priority:** P2 (nice to have)
- **Effort:** M
- **Depends on:** TW-WSP-010
- **Summary:** An artisan command deletes the business data of workspaces whose paid plan has been expired for longer than the plan's `data_retention_days` (0 = never wipe), stamping `data_wiped_at` so each workspace is wiped once. Dry-run by default.
- **Actors & access:** console command `workspaces:wipe-expired {--force}`; in production it is invoked once per day (cache lock `wipe-expired-daily-lock`, 24 h) from the 30-second Node heartbeat handler `WaConnectController` with `--force` (no scheduler entry exists: `php artisan schedule:list` is empty).
- **UX & screens:** none; console output lines "WIPED / would wipe workspace #id "name" (plan=..., expired <date>, retention=Nd) - N rows" and a log warning `[WIPE-EXPIRED]`.
- **Endpoints:** none.
- **Data:** for plans with `packages.data_retention_days > 0`, selects workspaces on that plan (matching `plan` by slug OR numeric id) with `data_wiped_at IS NULL`, `plan_ends_at IS NOT NULL` and `plan_ends_at < now - retention_days`. Deletes (children first, each table guarded by `Schema::hasTable/hasColumn`, each delete isolated in try/catch): `inbox_messages` and `conversation_participants` of the workspace's conversations, `wp_campaign_contacts` of its `wpcampaigns`, `broadcast_contacts` of its `broadcasts`, `messages` (if it has `workspace_id`), then every row with the workspace id in: contacts, contact_groups, conversations, wpcampaigns, broadcasts, flows, flow_subscribers, scheduled_messages, wa_templates, keyword_replies, deals, deal_activities, wa_orders, ai_agents, ai_training_sources, ai_chat_assistants, ai_call_assistants, appointments, saved_replies, attributes, chatbot_widgets, incoming_webhooks, devices, wa_provider_configs. On `--force` also `workspaces.data_wiped_at = now` and `plan = NULL`.
- **Rules & edge cases:**
  1. The workspace shell, owner account, members, teams, tags, orders, invoices, audit logs and files in storage are kept.
  2. QUIRK: `plan` is written as `NULL` but the column is `NOT NULL DEFAULT 'starter'`; under strict SQL that `save()` fails, is swallowed by the try/catch ("stamp failed") and `data_wiped_at` is not set, so the same workspace is re-wiped every day (harmless for already-empty data). Verify live.
  3. Deleting `devices` rows and `wa_provider_configs` does not tear down live Baileys sockets or provider webhook subscriptions.
  4. Not scheduled: if the heartbeat is not running (no connected devices) it never runs.
  5. `tables` lists are hard-coded; new tables added later are not covered.
- **Async & events:** log lines; no notification to the owner before wiping.
- **External systems:** none.
- **Settings:** package field `data_retention_days` (admin package editor; 0 = never).
- **Acceptance criteria:**
  - Given a plan with `data_retention_days = 30` and a workspace with `plan_ends_at` 45 days ago, When the command runs without `--force`, Then it lists the workspace with row counts and deletes nothing.
  - Given `--force`, Then those rows are deleted and `data_wiped_at` is stamped (given the plan-null quirk is fixed).
  - Given a plan with retention 0 or a workspace with `data_wiped_at` set, Then it is skipped.
- **Source refs:** `app/Console/Commands/WipeExpiredWorkspaces.php`, `app/Http/Controllers/WaConnectController.php` (heartbeat trigger), `database/migrations/2026_06_18_000300_add_data_wiped_at_to_workspaces.php`.
- **Port notes:** implement as a BullMQ repeatable job with a dry-run report, a pre-wipe warning email, per-table purge handlers registered by each domain module (not a central hard-coded list), and object-storage cleanup; write an audit row per wipe.

### TW-WSP-036 — Admin-provisioning fields stored but not enforced (caps, pre-seed, skip-onboarding)

- **Status:** docs-only
- **Priority:** P2 (nice to have)
- **Effort:** S
- **Depends on:** TW-WSP-024
- **Summary:** The admin create/edit forms and docs advertise per-workspace hard caps (monthly messages, daily messages, devices, users), "Pre-seed sample data" and "Skip onboarding email". They are saved to `workspaces` columns but no code reads them.
- **Actors & access:** admin group.
- **UX & screens:** inputs on the admin workspace create form (section "Limits & admin overrides") and the edit panel (four cap inputs with "inherit" placeholders).
- **Endpoints:** none of its own (covered by TW-WSP-024/026).
- **Data:** `workspaces.cap_monthly_messages` (bigint unsigned), `cap_daily_messages`, `cap_devices`, `cap_users` (int unsigned), `skip_onboarding_email`, `pre_seed_sample_data` (tinyint, default 0; the create form defaults the pre-seed toggle to ON).
- **Rules & edge cases:**
  1. A repository-wide search finds no consumer of these six fields outside the admin controller and model fillable/casts: limits are enforced only through package columns and `plan_overrides` (TW-WSP-010/031), so `cap_users` does not affect `user_seat_limit`, etc. No sample data is seeded, and no onboarding emails exist to skip.
  2. `bill_to_platform_credit` (same form) IS live: it is the BSP reseller billing switch read by `OverflowBilling` and `MessageBillingService` and also written from the client device-connect flow (`DevicesController`); it belongs to the BSP domain.
  3. For the port: either implement caps as overrides feeding entitlements or drop the fields; do not port silently non-functional columns.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an admin sets `cap_users = 3` for a workspace on a 10-seat plan, Then Reference v1.7.0 still allows 10 seats (parity check: this is documented non-behavior; port decision required).
  - Given `pre_seed_sample_data` is on, Then no demo rows are created (parity: no behavior).
- **Source refs:** `app/Http/Controllers/Admin/WorkspacesController.php`, `app/Models/Workspace.php`, `resources/views/admin/workspaces/create.blade.php`, `resources/views/admin/workspaces/detail.blade.php`, `Documentation/pages/admin-panel/workspaces.html`.
- **Port notes:** product decision item; recommended: fold caps into TW-WSP-031 overrides and implement a sample-data seeder as an opt-in job if wanted.

### TW-WSP-037 — Admin: users list

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** -
- **Summary:** Admin > Users lists every account on the platform with search, role and workspace filters, KPI counts and per-row actions (edit, reset email, login as, suspend, trash).
- **Actors & access:** admin group middleware only (no per-action Spatie permission: `users.view` etc. are seeded but never checked).
- **UX & screens:** `resources/views/admin/users/index.blade.php` (page key `users-index`, JS `users-index.js` = floating row menu). Header "All users", buttons Trash, Import CSV, Add user. KPI cards: Total (+N this month), Active (% active), Suspended ("policy violations"), Users ("standard user accounts"), Trashed ("recoverable 30d"). Filter pills (links that keep the query string): All, Admins, Users, Agents, Suspended with counts for all/admin/user/suspended (Agents has none), workspace `<select>` ("All workspaces"), search box "Search name, email, phone...". Table columns: Name (avatar/initials), Mobile No (full number with country code UNMASKED as `tel:` and wa.me link), Email id (mailto), Workspace (current workspace name + role label), Joined (relative), Vfd (suspended cross / verified check / "Email pending" clock icon), Verified by (WhatsApp OTP badge for `mobile_verified_at`, Email badge for `email_verified_at`, or dash), Login (impersonate icon, disabled/"Unavailable" for suspended users or users without a current workspace), Status (toggle switch that auto-submits the toggle route). Row menu: View profile, Edit user, Send reset email, Login as user (prompt reason), Suspend/Reactivate, Move to trash (confirm "Move X to trash? Recoverable for 30 days."). Empty "No users match your filters."; footer "Showing a-b of N users" + pagination.
- **Endpoints:**

  | Endpoint        | Route name        | Action                      | Middleware  | Request                     | Response |
  | --------------- | ----------------- | --------------------------- | ----------- | --------------------------- | -------- |
  | GET admin/users | admin.users.index | Admin\UsersController@index | admin group | q, role, workspace_id, page | HTML     |

- **Data:** reads `users` (soft-delete scope) with `currentWorkspaceRel`, `workspaces` (for the filter select).
- **Rules & edge cases:**
  1. `q` matches name, email or mobile (LIKE %q%); `role` = exact match on `users.role` when not `all` (valid values shown: admin, user, agent, suspended, also owner via URL); `workspace_id` numeric filters `current_workspace_id` (NOT membership). Order id desc, 12 per page, query string preserved.
  2. Stats: total = all non-deleted users; QUIRK: `active` = non-deleted count = total (soft-deleted are excluded by scope, so "Active" never differs from Total); admin count = `role='admin'`; users = `role='user'`; suspended = `role='suspended'`; trashed = only-trashed count; thisMonth = created since start of month. Accounts created through team invites carry the legacy role `'U'` (TW-WSP-016) and are counted in none of Admins/Users/Suspended.
  3. Verified icon: suspended wins, else verified if email OR mobile verified.
  4. "Login as user" impersonates the user's CURRENT workspace (TW-WSP-032), not the user's identity - there is no per-user impersonation despite the `users.login_as` seeded permission.
  5. The Status toggle posts `admin.users.toggle` (TW-WSP-040).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 30 users, When an admin opens the list, Then 12 rows show newest first with pagination and correct KPIs.
  - Given `?role=suspended`, Then only suspended users show.
  - Given `?workspace_id=5`, Then only users whose current workspace is 5 show.
  - Given a user with mobile "9876543210" and country code "91", Then the row shows `+91 9876543210` with tel and wa.me links.
  - Given a non-admin, Then 403.
- **Source refs:** `app/Http/Controllers/Admin/UsersController.php` (index), `resources/views/admin/users/index.blade.php`, `resources/js/charts/users-index.js`, `Documentation/pages/admin-panel/user-management.html`.
- **Port notes:** platform staff console over a cross-org `users` view; must respect the target model where users belong to one org (list shows org). Do not show unmasked phone numbers without a permission and an audit read event.

### TW-WSP-038 — Admin: create user

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WSP-046
- **Summary:** An admin creates a platform account with profile, role, optional current workspace, a password, and options to skip email verification, force a password change and send a welcome email.
- **Actors & access:** admin group. Creating `admin` or `owner` roles requires Super Admin (TW-WSP-046).
- **UX & screens:** `resources/views/admin/users/create.blade.php` (page key `admin-users-create`, JS `admin-users-form.js` = Tom Select country -> state -> city cascade via country-state-city). Sections: Personal details (full name*, email* "Used for login and notifications.", mobile* "Number with country code" (label says required; server treats it as optional), avatar upload with live preview "PNG/JPG - 200x200 recommended", gender radios Male/Female/Other), Access & role (workspace select "No workspace - platform admin" / each workspace, role select of Admin/Owner/User/Agent/Suspended, password* min 8 and confirm; toggles "Send welcome email" default ON, "Force password change - On first login" default ON, "Active immediately" default ON), Address & notes (address, country, state, city, ZIP/PIN, internal notes). Header copy: "The user will receive an email with a one-time login link." Success redirects to the edit page.
- **Endpoints:**

  | Endpoint               | Route name         | Action                       | Middleware  | Request        | Response                                   |
  | ---------------------- | ------------------ | ---------------------------- | ----------- | -------------- | ------------------------------------------ |
  | GET admin/users/create | admin.users.create | Admin\UsersController@create | admin group | -              | form                                       |
  | POST admin/users       | admin.users.store  | Admin\UsersController@store  | admin group | multipart form | redirect `admin.users.edit` with `success` |

- **Data:** inserts `users` (name, email, mobile, role, current_workspace_id, hashed password, address, city, state, country, zip, notes, force_password_change, email_verified_at now-or-null, referral_code auto-generated); avatar file `avatars/<id>_<uniqid>.<ext>` on the active media disk -> `users.avatar_path`; `welcome_email_sent_at`; `password_reset_tokens`; audit (`user.created` via observer; `admin.user.create_privileged_denied` on downgrade).
- **Rules & edge cases:**
  1. Validation: `name` required max 120; `email` required email max 191 unique across ALL users including soft-deleted; `mobile` nullable max 32; `role` required in admin|owner|user|agent|suspended; `workspace_id` nullable exists in workspaces; `password` required min 8 confirmed (field `password_confirmation`); `address` max 500; `city` max 120; `state` max 60; `country` max 8; `zip` max 24; `notes` max 1000; `avatar` nullable image jpg|jpeg|png|webp|gif max 2048 KB.
  2. Escalation guard: a non-Super-Admin choosing `admin` or `owner` gets `role='user'`, flash error "Creating admin/owner accounts requires Super Admin. User was created with the default role." and an audit failure row.
  3. `email_verified_at = now` only when the `active` toggle is on; otherwise NULL (the user must verify unless the platform `auto_verify_email` setting is on, which `EnsureUserActive` applies at first request).
  4. QUIRK: `workspace_id` only sets `users.current_workspace_id`; NO `workspace_user` row is created, so the user has no workspace role (role-gated pages redirect to `/team-inbox`; `workspaceRole()` null) until membership is added through invite. Same in import (TW-WSP-045).
  5. QUIRK: the gender radios are submitted but ignored (no column); the "Force password change" flag is stored but not enforced anywhere (TW-WSP-047).
  6. Welcome email (only when the toggle is on): pre-flight `mailConfigError` returns a reason string when there is no default mailer, `MAIL_FROM_ADDRESS` is empty or `hello@example.com`, or (smtp) the host is empty/`127.0.0.1` without `MAIL_HOST` or the port is empty (`log`, `array`, `sendmail` always pass). Otherwise generates a password-reset token (best-effort), sends `AdminWelcomeMail` containing the plaintext password and reset link, and stamps `welcome_email_sent_at`. Transport errors map to friendly reasons ("SMTP authentication failed - check username/password.", "SMTP connection refused - check host/port.", "SMTP server timed out.", "SMTP server unreachable.", "mail transport error (see logs)."). Creation is never rolled back for mail failure; flash "User created - welcome email skipped: <reason>".
  7. Avatar: stored after create so the file name has the id; extension lower-cased (default jpg); an existing UPLOADED avatar is deleted best-effort, social URLs (http/https) are never deleted.
- **Async & events:** synchronous mail; observer audit `user.created`; referral code generated in the model's `creating` hook (TW-WSP-047).
- **External systems:** mailer; media disk storage (local/S3/etc. per storage settings).
- **Settings:** mail config; `auto_verify_email`; media disk settings (SET domain).
- **Acceptance criteria:**
  - Given a Super Admin, When they create a user with role `admin`, Then the account has role `admin`.
  - Given a regular Admin choosing role `owner`, Then the user is created with role `user`, the error flash appears and an audit failure exists.
  - Given an existing email (even trashed), Then a validation error.
  - Given "Send welcome email" with a configured mailer, Then the user receives the email with the password and `welcome_email_sent_at` is set; with `MAIL_FROM_ADDRESS` unset, Then the user is created and the flash names the reason.
  - Given password and confirmation that differ, Then a validation error.
- **Source refs:** `app/Http/Controllers/Admin/UsersController.php` (create, store, sendWelcomeEmail, mailConfigError, validateUserPayload, storeAvatarIfPresent, roleOptions), `app/Mail/AdminWelcomeMail.php`, `resources/views/emails/admin-welcome.blade.php`, `resources/views/admin/users/create.blade.php`, `resources/js/charts/admin-users-form.js`, `Documentation/pages/admin-panel/user-management.html`.
- **Port notes:** In the target, "create user" = create staff user in an org with an RBAC role and a set-password invitation; do not persist plaintext-emailed passwords. Profile address fields go to a `user_profiles` jsonb. Avatar upload goes through the storage adapter (SET domain).

### TW-WSP-039 — Admin: edit user

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WSP-046
- **Summary:** Admins change any profile field, role, current workspace, email-verified state and password of a user, and can trigger reset email, force logout and trash from the same screen.
- **Actors & access:** admin group; role changes touching admin/owner require Super Admin (TW-WSP-046).
- **UX & screens:** `resources/views/admin/users/edit.blade.php` (page key `admin-users-edit`, same JS as create). Same sections as create with prefilled values, password placeholder "Leave blank to keep existing", welcome-email toggle default OFF (helper "Last sent <relative>" or "With magic-link login"), "Force password change - On next login", "Email verified" toggle, header status pill, Suspend/Reactivate and "Save changes" buttons, meta line "Workspace: <name> - Joined <date> - Verified <relative>", success flash, and a Danger zone with Reset password ("Send reset link via email"), Force logout ("Revoke all active sessions", confirm "Sign out all active sessions for this user? They'll need to log in again on every device.") and Move to trash ("Recoverable for 30 days"). A footer note claims saving triggers an email when the email changes (not implemented).
- **Endpoints:**

  | Endpoint                  | Route name         | Action                       | Middleware  | Request        | Response                                           |
  | ------------------------- | ------------------ | ---------------------------- | ----------- | -------------- | -------------------------------------------------- |
  | GET admin/users/{id}/edit | admin.users.edit   | Admin\UsersController@edit   | admin group | -              | form (opens trashed users too)                     |
  | PUT admin/users/{id}      | admin.users.update | Admin\UsersController@update | admin group | multipart form | back with `success` message assembled from notices |

- **Data:** updates `users` fields as in create plus `email_verified_at`, `password` (when provided), `avatar_path`, `welcome_email_sent_at`; audit `admin.user.role_changed {from,to}` or `admin.user.role_change_denied`; observer `user.updated` with change map (password and remember token values redacted by the audit scrubber).
- **Rules & edge cases:**
  1. Validation as create except password `nullable|string|min:8|confirmed` and email unique ignoring self. `update` uses `findOrFail` on the non-trashed set (a trashed user can be opened in edit but saving returns 404 - restore first).
  2. Role escalation guard: if the role changes and either the old or new role is admin/owner and the caller is not Super Admin, the role reverts to the previous value with flash "Promoting/demoting admin or owner roles requires Super Admin. Other changes were saved." and an audit failure row; otherwise a real change is audited as `admin.user.role_changed`.
  3. QUIRK: `current_workspace_id` is always overwritten with the submitted `workspace_id` or NULL when the select is blank, and no pivot changes occur; saving an edit with the empty option clears the user's current workspace pointer.
  4. Email verified toggle: ON with an unverified user -> `email_verified_at = now`. OFF with a verified user -> attempts `EmailVerificationController::send`; on success clears verification and appends "Verification email sent to <email>."; when mail is unavailable the user is KEPT verified and the notice reads "Kept email verified (cannot send verification: <reason>)." (so nobody is locked out).
  5. `force_password_change` = the checkbox (0/1). A new password (hashed) never sets `password_changed_at`.
  6. Welcome email option calls the same sender as create with the NEW plaintext password (or none when unchanged), appends "Welcome email skipped: <reason>" on failure.
  7. Success message: "User updated." + optional verify notice + optional mail notice.
  8. Editing the email does not re-verify or notify (the footer copy is wrong). Suspended (role `suspended`) is one of the selectable roles here, so saving with that value suspends without the privileged check on target roles other than admin/owner.
  9. Admin can edit a Super Admin's profile and password (TW-WSP-046 quirk).
- **Async & events:** synchronous mail; audit rows.
- **External systems:** mailer, media disk.
- **Settings:** mail config.
- **Acceptance criteria:**
  - Given an Admin, When they change a user's name and mobile, Then the fields save and "User updated." shows.
  - Given a regular Admin promoting a user to `admin`, Then the role is unchanged, the other changes are saved and the Super Admin flash appears.
  - Given the verified toggle turned off with mail working, Then the user becomes unverified and gets a verification email.
  - Given a blank password, Then the password is unchanged.
  - Given an email used by another user, Then a validation error.
- **Source refs:** `app/Http/Controllers/Admin/UsersController.php` (edit, update), `app/Http/Controllers/EmailVerificationController.php` (send), `resources/views/admin/users/edit.blade.php`, `resources/js/charts/admin-users-form.js`, `Documentation/pages/admin-panel/user-management.html`.
- **Port notes:** separate "edit profile", "change role" and "set password" commands with distinct permissions; never allow a lower-privileged admin to change a higher-privileged user's credentials.

### TW-WSP-040 — Admin: suspend / reactivate user and suspended-account screen

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S
- **Depends on:** TW-WSP-046
- **Summary:** Admins block a user's access to the app by setting the platform role to `suspended`; the user can still sign in but every non-exempt page redirects to "Your account is currently suspended". Reactivation restores the `user` role.
- **Actors & access:** admin group; suspending an admin/owner needs Super Admin.
- **UX & screens:** Status toggle and row menu on the list, Suspend/Reactivate button on the edit page. User side: `resources/views/auth/suspended.blade.php` at `GET account/suspended` (route `account.suspended`, a `Route::view` behind `Authenticate`): "Your account is currently suspended - Hi <name>, an administrator has suspended this account. You can still sign in, but the rest of the app is locked until a <brand> admin reactivates you. If you believe this is a mistake, please contact your workspace owner or <mail from address>." plus a Sign out button.
- **Endpoints:**

  | Endpoint                     | Route name         | Action                             | Middleware   | Request | Response                                                   |
  | ---------------------------- | ------------------ | ---------------------------------- | ------------ | ------- | ---------------------------------------------------------- |
  | POST admin/users/{id}/toggle | admin.users.toggle | Admin\UsersController@toggleStatus | admin group  | -       | back with "User suspended." / "User reactivated." or error |
  | GET account/suspended        | account.suspended  | Illuminate\Routing\ViewController  | Authenticate | -       | suspended view                                             |

- **Data:** `users.role` flips `suspended` <-> `user`; audit `admin.user.suspended` / `admin.user.reactivated` / `admin.user.suspend_privileged_denied` (failure).
- **Rules & edge cases:**
  1. Guard: target role admin or owner and caller not Super Admin -> flash error "Suspending an admin or owner requires Super Admin." with audit failure.
  2. QUIRK: reactivation always writes `user`, discarding the previous role (`agent`, `owner`, `admin`), contrary to the docs ("flips between the user's normal role and Suspended"). The original role is not saved anywhere.
  3. Enforcement: `EnsureUserActive` (global web middleware) redirects a `suspended` user to `account.suspended` for every route except its allow-list (account.suspended, account.verify-email, logout, verification._, register.workspace_, register.plan*); admins (roles admin, super-admin, platform-admin) are exempt. Not enforced: existing sessions are not revoked on suspend (the redirect covers them), Sanctum API/mobile tokens and the REST API key path may not check the role (verify live), background sends by the user's workspace continue.
  4. Suspension is account-wide (all workspaces), unlike workspace suspension (TW-WSP-027).
- **Async & events:** audit rows.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active user, When an admin toggles, Then `role='suspended'` and on the user's next request they are redirected to `/account/suspended`; toggling again sets `role='user'`.
  - Given a regular Admin toggling an admin user, Then the error flash and no change.
  - Given a suspended user, Then they can still POST logout.
- **Source refs:** `app/Http/Controllers/Admin/UsersController.php` (toggleStatus), `app/Http/Middleware/EnsureUserActive.php`, `resources/views/auth/suspended.blade.php`, `routes/web.php` (account.suspended), `Documentation/pages/admin-panel/user-management.html`.
- **Port notes:** model as `users.status = 'suspended'` (target users already have `status`), preserving role assignments; enforce in the auth guard (JWT verification consults status or a revocation list) so tokens die immediately.

### TW-WSP-041 — Admin: send password-reset email (rate limited)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** -
- **Summary:** Admins email a standard password-reset link to a user, limited to 5 sends per admin per hour, with every attempt audited.
- **Actors & access:** admin group.
- **UX & screens:** "Send reset email" in the list row menu and "Reset password - Send reset link via email" in the edit Danger zone; flash "Password reset link sent to <email>" or "Too many password reset emails - try again in N minute(s)."
- **Endpoints:**

  | Endpoint                    | Route name        | Action                              | Middleware  | Request | Response        |
  | --------------------------- | ----------------- | ----------------------------------- | ----------- | ------- | --------------- |
  | POST admin/users/{id}/reset | admin.users.reset | Admin\UsersController@resetPassword | admin group | -       | back with flash |

- **Data:** `password_reset_tokens` (via the broker), rate-limiter cache key `admin-reset:<admin id>`; audit `admin.user.reset_password_sent {email}` or `admin.user.reset_password_throttled {retry_after_seconds}` (failure).
- **Rules & edge cases:**
  1. Limit: `tooManyAttempts(key, 5)`; each allowed call does `hit(key, 3600)` BEFORE sending, so failed sends count. Minutes shown = ceil(seconds/60).
  2. `Password::sendResetLink(['email'])` result is ignored: the flash says "sent" even when the broker throttles the per-email 60s window or mail fails (QUIRK).
  3. Does not invalidate the current password or sessions (use force logout, TW-WSP-042).
- **Async & events:** mail sent by the broker's notification (queue per app config).
- **External systems:** mailer.
- **Settings:** `config/auth.php` password broker expiry/throttle.
- **Acceptance criteria:**
  - Given an admin, When they send a reset, Then the user receives the standard reset email and an audit `admin.user.reset_password_sent` row exists.
  - Given the same admin sends a 6th reset within an hour, Then the error flash with the wait time appears, no email is sent and a throttled audit failure exists.
- **Source refs:** `app/Http/Controllers/Admin/UsersController.php` (resetPassword), `Documentation/pages/admin-panel/user-management.html`.
- **Port notes:** use the AUTH domain's reset-token service with the same per-actor throttle (Redis token bucket), and surface real send status.

### TW-WSP-042 — Admin: force logout (revoke all sessions)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** -
- **Summary:** Deletes every server-side session row of a user so all their devices must sign in again.
- **Actors & access:** admin group.
- **UX & screens:** edit page Danger zone "Force logout - Revoke all active sessions" (confirm "Sign out all active sessions for this user? They'll need to log in again on every device.", button "Sign out everywhere"); flash "Force-logged out - N active session(s) revoked."
- **Endpoints:**

  | Endpoint                           | Route name               | Action                            | Middleware  | Request | Response        |
  | ---------------------------------- | ------------------------ | --------------------------------- | ----------- | ------- | --------------- |
  | POST admin/users/{id}/force-logout | admin.users.force-logout | Admin\UsersController@forceLogout | admin group | -       | back with flash |

- **Data:** `DELETE FROM sessions WHERE user_id = ?` (requires `SESSION_DRIVER=database`, the default); audit `admin.user.force_logout {sessions_revoked, email}`.
- **Rules & edge cases:**
  1. Only web sessions are revoked. Not revoked: "remember me" tokens (a new session can be re-created from the cookie), Sanctum personal access tokens for the mobile app, extension API tokens, API keys, 2FA state.
  2. Singular/plural message ("1 active session").
  3. Works on the acting admin's own account too (logs them out).
- **Async & events:** audit row.
- **External systems:** none.
- **Settings:** `SESSION_DRIVER`.
- **Acceptance criteria:**
  - Given a user with 3 sessions, When forced out, Then 0 `sessions` rows remain for them and the flash says 3 revoked.
  - Given the user tries any page afterwards, Then they are redirected to login.
- **Source refs:** `app/Http/Controllers/Admin/UsersController.php` (forceLogout), `config/session.php`.
- **Port notes:** implement as a refresh-token/session family revocation in AUTH (Redis session store) plus a `token_version` bump on the user so JWTs are rejected immediately; include mobile tokens and API keys optionally.

### TW-WSP-043 — Admin: move user to trash

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** -
- **Summary:** Soft-deletes a user account; the person can no longer sign in and the record is recoverable from the Trash for 30 days (manually).
- **Actors & access:** admin group; any admin (no Super Admin requirement).
- **UX & screens:** row menu and edit Danger zone with confirm "Move X to trash? Recoverable for 30 days."
- **Endpoints:**

  | Endpoint                | Route name          | Action                        | Middleware  | Request | Response                                                                             |
  | ----------------------- | ------------------- | ----------------------------- | ----------- | ------- | ------------------------------------------------------------------------------------ |
  | DELETE admin/users/{id} | admin.users.destroy | Admin\UsersController@destroy | admin group | -       | back with "User moved to trash." or error `user` "You can't trash your own account." |

- **Data:** sets `users.deleted_at`; observer audit `user.deleted`.
- **Rules & edge cases:**
  1. Self-trash blocked. No guard against trashing a Super Admin, another admin or a workspace owner (QUIRK: a regular admin can trash a Super Admin; trashing an owner leaves the workspace with a dangling `owner_user_id`).
  2. Soft-deleted users vanish from `Auth::user()` (default scope) so their next request is unauthenticated; their sessions are not deleted, and Sanctum tokens for a trashed user stop resolving.
  3. Their email stays reserved (unique index includes trashed rows), so registering or inviting the same address fails until the record is force-deleted.
  4. Membership rows, contacts, conversations assigned to the user remain.
- **Async & events:** audit row.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an admin, When they trash another user, Then `deleted_at` is set, the user disappears from the list, appears in Trash and cannot log in.
  - Given an admin trashing themself, Then the error "You can't trash your own account."
- **Source refs:** `app/Http/Controllers/Admin/UsersController.php` (destroy), `app/Models/User.php` (SoftDeletes).
- **Port notes:** in the port apply guards: cannot delete the last org owner or a higher-privileged staff member; deactivate first, then schedule purge.

### TW-WSP-044 — Admin: users trash, restore, force delete, empty trash

- **Status:** partial
- **Priority:** P1 (expected by customers)
- **Effort:** M
- **Depends on:** TW-WSP-043
- **Summary:** A Trash screen lists soft-deleted users with a 30-day countdown, lets admins restore one, permanently delete one, or purge everything older than 30 days. Automatic nightly purge is advertised in the UI but not implemented.
- **Actors & access:** admin group.
- **UX & screens:** `resources/views/admin/users/trash.blade.php` header "Trashed users" with "Back to users" and "Empty trash" (confirm "Permanently delete every trashed user older than 30 days? This cannot be undone."), KPI text "N deleted accounts. Trashed users are recoverable for 30 days...", warning banner "Permanent deletion is irreversible", pills (All trashed, Last 7 days, Expiring soon, each with count) and search, table (image/initials, user name + email (+ masked phone), workspace or "(no workspace)", Trashed relative, "Auto-delete in N days" (rows with <= 7 days highlighted amber), role, Restore and "Delete now" buttons (confirm "Permanently delete X? This cannot be undone - all related contacts and messages will be wiped.")), empty states ("No trashed users match those filters." / "Nothing in trash..."), footer "Showing a-b of N trashed" and text "Auto-deletion runs nightly at 02:00 UTC".
- **Endpoints:**

  | Endpoint                      | Route name               | Action                            | Middleware  | Request                               | Response                                                                                                                                         |
  | ----------------------------- | ------------------------ | --------------------------------- | ----------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
  | GET admin/users/trash         | admin.users.trash        | Admin\UsersController@trash       | admin group | filter (all/recent/expiring), q, page | HTML                                                                                                                                             |
  | POST admin/users/{id}/restore | admin.users.restore      | Admin\UsersController@restore     | admin group | -                                     | back with `User "<name>" restored.`                                                                                                              |
  | DELETE admin/users/{id}/force | admin.users.force-delete | Admin\UsersController@forceDelete | admin group | -                                     | back with `User "<name>" permanently deleted.`                                                                                                   |
  | POST admin/users/trash/empty  | admin.users.trash.empty  | Admin\UsersController@emptyTrash  | admin group | -                                     | back with "Permanently deleted N expired users (older than 30 days)." or "Nothing to empty - no trashed users are past the 30-day grace window." |

- **Data:** reads/writes `users` (`deleted_at`), audit `admin.user.restore`, `admin.user.force_delete`, `admin.user.empty_trash {count}`.
- **Rules & edge cases:**
  1. Listing: only-trashed, `deleted_at` desc, 12 per page. `recent` = trashed within 7 days; `expiring` = trashed at least 23 days ago. Days left = `max(0, 30 - whole days since deletion)`.
  2. QUIRK: the search `q` also queries `users.phone`, a column that does not exist (the table has `mobile`), so any non-empty search on the Trash page errors with an SQL exception; the row template also reads `$u->phone` (always null).
  3. Restore and force delete look up `onlyTrashed` (404 otherwise); force delete writes the audit row BEFORE deleting; it hard-deletes only the `users` row. FK behavior: `referred_by_user_id` of referrals is set NULL, `user_otps` cascades; membership rows, workspace ownership, conversations/notes authored by the user, tokens and other tables are left with dangling ids (no FK). The UI claim that "all related contacts, messages and audit records are wiped" is false.
  4. Empty trash force-deletes each user with `deleted_at < now - 30 days` (no batching) and audits the count.
  5. No scheduled job purges after 30 days (`schedule:list` is empty; no command) so "Auto-deletion runs nightly at 02:00 UTC" is docs/UI-only; the list just shows a countdown that reaches 0.
  6. Restore does not re-verify or re-enable anything else; suspended role persists.
- **Async & events:** audit rows.
- **External systems:** none.
- **Settings:** none (30-day window hard-coded).
- **Acceptance criteria:**
  - Given a user trashed 25 days ago, Then Trash shows "5 days" left and it appears under "Expiring soon".
  - Given restore, Then `deleted_at` is NULL and the user reappears in the main list.
  - Given force delete, Then the row is gone and an audit `admin.user.force_delete` exists.
  - Given users trashed 10 and 40 days ago, When "Empty trash" runs, Then only the 40-day user is deleted and the flash reports 1.
  - Given a search on the Trash page (parity note), Then Reference 500s; the port must search name/email.
- **Source refs:** `app/Http/Controllers/Admin/UsersController.php` (trash, restore, forceDelete, emptyTrash), `resources/views/admin/users/trash.blade.php`, `Documentation/pages/admin-panel/user-management.html`.
- **Port notes:** implement a real retention purge worker (BullMQ repeatable) and anonymisation instead of hard delete where audit references exist.

### TW-WSP-045 — Admin: bulk CSV user import and template

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** M
- **Depends on:** TW-WSP-046
- **Summary:** Admins upload a CSV (up to 5,000 rows / 10 MB) to create many users at once with role, workspace and verification defaults, optionally emailing each a welcome message; a summary of the last import is stored and shown.
- **Actors & access:** admin group; admin/owner roles in the file are silently downgraded to `user` for non-Super-Admins.
- **UX & screens:** `resources/views/admin/users/import.blade.php` (page key not registered; the JS is inlined in a `@push('scripts')` block mirroring `resources/js/charts/admin-users-import.js`): step 1 download the template ("users-template.csv", columns name, email, mobile, role, workspace, gender, address, status), step 2 drag-and-drop or browse (client checks `.csv` and 10 MB, shows "Ready - N KB"), step 3 options: Default workspace (or "Use CSV value"), Default role select, "Send welcome email" (magic-link per row), "Skip duplicates" (match by email). Requirements list: UTF-8, comma-separated, header row, required name and email. Result banners (success/error) plus up to 20 "Rows that need attention" lines and a "Last import: N users imported - K skipped (duplicates) - M failed - <relative>" line.
- **Endpoints:**

  | Endpoint                        | Route name                  | Action                                  | Middleware  | Request                                                                 | Response                                                                                                                                          |
  | ------------------------------- | --------------------------- | --------------------------------------- | ----------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
  | GET admin/users/import          | admin.users.import          | Admin\UsersController@importForm        | admin group | -                                                                       | form + last summary                                                                                                                               |
  | POST admin/users/import         | admin.users.import.store    | Admin\UsersController@import            | admin group | csv, default_role, default_workspace_id, welcome_email, skip_duplicates | redirect to import page with `success`/`error` and `import_errors`                                                                                |
  | GET admin/users/import/template | admin.users.import.template | AdminPagesController@userImportTemplate | admin group | -                                                                       | streamed `users-import-template.csv` (header + one sample row `Jane Doe, jane@example.com, +15551234567, user, Acme, female, 12 Main St, active`) |

- **Data:** inserts `users`; `system_settings.users_last_import` JSON `{created, skipped, failed, total, at (ISO-8601), by (admin name)}`; audit `admin.users.bulk_import {created, skipped, failed, rows}`.
- **Rules & edge cases:**
  1. Validation: `csv` required file mimes csv|txt max 10240 KB; `default_role` nullable string (must be one of admin, owner, user, agent, suspended else `user`); `default_workspace_id` nullable integer exists.
  2. Header row lower-cased/trimmed; must contain `name` and `email` else error "The CSV must have at least "name" and "email" header columns."; empty file -> "The CSV is empty or has no header row."; unreadable -> "Could not read the uploaded file."
  3. Row loop: skip completely blank lines; stop with error "Stopped at 5,000 rows (file limit)." after 5,000 data rows; a row needs a non-empty name and a valid email (lower-cased) else "Row N: missing/invalid name or email - skipped." (counted failed).
  4. Duplicates are looked up with trashed users included: with `skip_duplicates` they are counted skipped, otherwise failed "Row N: <email> already exists."
  5. Role = CSV `role` if one of the allowed roles else the default; admin/owner downgraded to `user` if the caller is not Super Admin (no error). Workspace = CSV `workspace` matched case-insensitively to a workspace NAME (first wins on duplicate names) else the default id; sets `current_workspace_id` only (no membership row - same quirk as TW-WSP-038). `status` blank or one of active|enabled|1|true|yes -> verified now, anything else -> unverified. `mobile`, `address` copied; gender/city/etc. ignored; `force_password_change` not set.
  6. Password = `Str::password(16)` hashed; when "Send welcome email" is on, the same sender as TW-WSP-038 is called (best-effort; its skip reason is ignored per row).
  7. Each row is created inside a try/catch (failure -> "Row N: <first 80 chars of exception>" and a `[USER-IMPORT]` warning log); no surrounding transaction (partial imports persist).
  8. Redirect flashes `success` "Imported N user(s). Skipped K duplicate(s). M failed." or `error` when there were failures and nothing was created; errors limited to the first 20.
- **Async & events:** synchronous in the request (long imports can hit PHP time limits); audit rows plus per-user `user.created` observer rows.
- **External systems:** mailer (optional).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a CSV with 3 valid rows, When imported with defaults, Then 3 users exist with random passwords, verified now, and the flash says "Imported 3 user(s)."
  - Given an existing email with "Skip duplicates" on, Then it is counted as skipped, not failed.
  - Given a CSV missing the `email` header, Then the error flash and no rows.
  - Given a regular Admin and a row role `admin`, Then that user is created as `user`.
  - Given a 5,001-row file, Then 5,000 are processed and the "Stopped at 5,000 rows" line appears.
- **Source refs:** `app/Http/Controllers/Admin/UsersController.php` (importForm, import), `app/Http/Controllers/AdminPagesController.php` (userImportTemplate), `resources/views/admin/users/import.blade.php`, `resources/js/charts/admin-users-import.js`, `Documentation/pages/admin-panel/user-management.html`.
- **Port notes:** run as a BullMQ import job with a progress record and downloadable error report; create membership + role for the chosen org; email invitations via outbox with set-password tokens.

### TW-WSP-046 — Privileged-role escalation guard (Super Admin gate)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S
- **Depends on:** -
- **Summary:** A cross-cutting rule in the admin user screens: only a Super Admin may create, promote, demote or suspend accounts whose role is `admin` or `owner`. A regular admin's attempt is downgraded or reverted and recorded as a failure in the audit log.
- **Actors & access:** applies inside `Admin\UsersController` store, update, toggleStatus and import. Super Admin = `PlatformPermissions::isSuperAdmin`: `users.role` in super_admin, super-admin, platform-admin OR Spatie role "Super Admin".
- **UX & screens:** flash messages: "Creating admin/owner accounts requires Super Admin. User was created with the default role.", "Promoting/demoting admin or owner roles requires Super Admin. Other changes were saved.", "Suspending an admin or owner requires Super Admin." (import downgrades silently).
- **Endpoints:** covered by TW-WSP-038, 039, 040, 045.
- **Data:** `audit_logs` actions `admin.user.create_privileged_denied`, `admin.user.role_change_denied`, `admin.user.suspend_privileged_denied` (result `failure`, meta with attempted role and reason `requires_super_admin`).
- **Rules & edge cases:**
  1. Create: requested role admin/owner + non-super -> role becomes `user`.
  2. Update: role changes where old OR new role is admin/owner + non-super -> revert to old role; other fields still saved.
  3. Toggle: target role admin/owner + non-super -> refuse.
  4. Import: admin/owner rows -> `user` for non-super.
  5. QUIRK gaps (a regular admin can still): edit a Super Admin's name, email and PASSWORD (an account-takeover path), trash them (TW-WSP-043), send resets, force-logout them, and change the `workspace_id`. Also the role options do not include a super-admin value, so Super Admin can only be granted through Spatie role management (RBAC domain).
- **Async & events:** audit rows.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a regular Admin, When they create a user with role `owner`, Then the user is created with role `user` and an audit failure row exists.
  - Given a Super Admin, Then all four operations succeed with roles preserved.
  - Given a regular Admin editing a Super Admin's password, Then it succeeds in Reference (document; port should block).
- **Source refs:** `app/Http/Controllers/Admin/UsersController.php`, `app/Support/PlatformPermissions.php` (isSuperAdmin).
- **Port notes:** enforce privilege ordering centrally in the staff-user service ("actor rank >= target rank" for every mutating action), backed by RBAC permissions (`staff.manage_privileged`).

### TW-WSP-047 — User account entity (`users`) and platform role column

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** -
- **Summary:** The `users` table and model define accounts: identity, credentials, profile/address, verification state, wallet balance, referral code, 2FA secrets, preferences, the single string `role` column (platform-level) and the pointer to the current workspace. Platform admin power comes from `role` plus Spatie roles/permissions; workspace power comes from `workspace_user.role`.
- **Actors & access:** every feature; model-level behaviors below.
- **UX & screens:** none directly (avatars via `avatar_url`, initials fallback).
- **Endpoints:** none.
- **Data:** see Data model (`users`, `user_otps`, `user_device_tokens`).
- **Rules & edge cases:**
  1. `role` values in use: `user` (default), `admin`, `owner`, `agent`, `suspended`, legacy `U`, `A`, plus `super_admin`/`super-admin`/`platform-admin` recognised by helper checks. `isAdmin()` = Spatie role Super Admin or Admin, OR `role` in (`admin`, `A`). The admin UI writes only admin|owner|user|agent|suspended.
  2. Email is unique across the whole table including soft-deleted rows (`users_email_unique`); `site_name` is a legacy unique slug (auto-created for invited users, may be null); `referral_code` is auto-generated on create (10 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, retry until unique).
  3. `password` cast `hashed`; `two_factor_secret` and `two_factor_recovery_codes` cast `encrypted`; hidden from serialization: password, passcode, remember_token, 2FA fields.
  4. `force_password_change` / `password_changed_at`: written by admin forms, by the password-max-age policy at login (sets the flag when stale) and cleared by the account password-change screen, but NO middleware or login step reads the flag to force a change (QUIRK: every "forced change on first login" promise in the docs and emails is unenforced).
  5. `avatar_url` accessor: null if no path; absolute http(s) paths (social login) returned as is; else `media_url(path)`.
  6. Wallet columns (`wallet_credits`, `wallet_currency_minor`, `wallet_currency_code` default INR) live here (WALLET domain owns semantics).
  7. `AuditableObserver` logs every create/update/delete/restore of `User` (`user.created` etc.).
  8. Relations: `workspaces()` (pivot with role, invited_at, joined_at), `ownedWorkspaces()`, `currentWorkspace()`, `teams()`, `agentStatus()`, `referrer/referrals`, `supportAgent()` (platform support desk, workspace NULL).
  9. `UserOtp`: one row per user (unique user_id) holding an email OTP (max 10 chars) and `expires_at`, replaced on each resend and deleted after verify - used by the mobile app's 2FA verify flow (AUTH/MOB domains). `UserDeviceToken`: mobile push registrations (`fcm_token` text, `token_hash` sha256 unique, `platform`, `device_info` JSON, `last_used_at`, optional workspace/device ids) upserted by hash (MOB domain).
- **Async & events:** observer audit; `LogsNotifications` not applied to `User`.
- **External systems:** none.
- **Settings:** `auto_verify_email` (default true) auto-verifies at first request; password policy settings (AUTH).
- **Acceptance criteria:**
  - Given a new user is created without a referral code, Then a 10-char code from the allowed alphabet is stored.
  - Given a second user with an email of a soft-deleted user, Then the unique index rejects it.
  - Given `role='A'`, Then `isAdmin()` is true.
  - Given `force_password_change=1`, Then Reference still lets the user in without changing it (parity: unenforced).
- **Source refs:** `app/Models/User.php`, `app/Models/UserOtp.php`, `app/Models/UserDeviceToken.php`, `app/Observers/AuditableObserver.php`, `app/Http/Middleware/EnsureUserActive.php`, `app/Http/Middleware/EnsureUserIsAdmin.php`.
- **Port notes:** STRUCTURAL DECISION: the target `users` table is `(org_id, id)`-scoped with `UNIQUE(org_id, email)` - one user belongs to one org. Reference's many-to-many `workspace_user` (one login, many workspaces, different role per workspace) and the shared "current workspace" require either (a) a global `accounts`/`identities` table linked to per-org `users` rows (recommended: same email in several orgs = several org users under one identity/SSO subject; switching orgs = re-issuing a token), or (b) dropping multi-workspace membership. Decide before building TW-WSP-003/005/016. Platform staff should be a separate identity type not bound to a tenant org.

## Data model

Final MySQL shape from `SHOW CREATE TABLE` on the seeded reference database (InnoDB, utf8mb4_unicode_ci). JSON columns are `longtext` with a JSON check constraint. All timestamps are `timestamp NULL`.

### `workspaces` (model `Workspace`, soft delete, tenant root; ~1 row per customer business; hundreds to tens of thousands)

Read/written by nearly every feature here (TW-WSP-001..011, 023..036). Indexes: PK `id`, UNIQUE `workspaces_slug_unique(slug)` (includes soft-deleted rows), `owner_user_id`, `default_voice_ai_agent_id`, `data_wiped_at`. No foreign keys anywhere (owner, agent id are unconstrained bigints).

| Column                                                                          | Type / default                                                                                                                       | Behavior                                                                                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| id                                                                              | bigint unsigned PK                                                                                                                   | tenant id used as `workspace_id` in ~all tables                                                                                              |
| owner_user_id                                                                   | bigint unsigned NOT NULL                                                                                                             | owner account (no FK); ownership checks (`settingsUpdate`, delete, export) use this column, not the pivot role                               |
| name                                                                            | varchar(255)                                                                                                                         | max 120 enforced at create, 191 in settings form                                                                                             |
| slug                                                                            | varchar(255) UNIQUE                                                                                                                  | URL slug; generated (TW-WSP-004); regex `^[a-z0-9-]*$` when admin-typed                                                                      |
| custom_domain                                                                   | varchar(191) NULL                                                                                                                    | white-label host (regex `^[a-z0-9.-]+\.[a-z]{2,}$`, unique via validation only - no DB unique index)                                         |
| cname_verified                                                                  | tinyint(1) default 0                                                                                                                 | set by TW-WSP-030; required for tenant resolution                                                                                            |
| plan                                                                            | varchar(32) NOT NULL default 'starter'                                                                                               | package slug (`packages.plan_id`) at signup, numeric package id (as string) from checkout/admin edit; resolved by `package()` accepting both |
| enabled_engines                                                                 | JSON NULL                                                                                                                            | array of provider keys the workspace may use (subset filter; NULL/empty = all allowed)                                                       |
| default_engine                                                                  | varchar(16) NULL                                                                                                                     | reserved default sender engine (resolution currently ignores it)                                                                             |
| meta_agent_enabled                                                              | tinyint(1) default 0                                                                                                                 | Meta Business Agent coexistence                                                                                                              |
| ai_responder_mode                                                               | varchar(32) default 'threadwise_only'                                                                                                | `threadwise_only` \| `meta_agent_only` \| `meta_agent_then_handoff`                                                                          |
| billing_cycle                                                                   | varchar(20) default 'monthly'                                                                                                        | `monthly, quarterly, annual, custom, trial` (admin), `trial` set at free signup                                                              |
| trial_ends_at / plan_ends_at                                                    | timestamp NULL                                                                                                                       | trial window (free plans) / paid window; expiry drives `package()` downgrade and trial gate                                                  |
| cap_monthly_messages, cap_daily_messages                                        | bigint unsigned NULL                                                                                                                 | stored, never read (TW-WSP-036)                                                                                                              |
| cap_devices, cap_users                                                          | int unsigned NULL                                                                                                                    | stored, never read                                                                                                                           |
| plan_overrides                                                                  | JSON NULL                                                                                                                            | `{limit_key: int}` per-workspace overrides, `-1` = unlimited (TW-WSP-031)                                                                    |
| brand_primary, brand_accent, brand_background                                   | varchar(16) NULL                                                                                                                     | hex `^#[0-9a-fA-F]{6}$` via Settings > Branding (SET/CMS domain owns the tab)                                                                |
| brand_logo_path, brand_favicon_path                                             | varchar(255) NULL                                                                                                                    | uploaded to `public` disk under `branding/<workspace id>/`                                                                                   |
| brand_color                                                                     | varchar(16) default '#075E54' NULL                                                                                                   | tile/tint colour; null or default = follow theme                                                                                             |
| branding_footer                                                                 | varchar(60) NULL                                                                                                                     | plan-gated outbound footer (`remove_branding` feature)                                                                                       |
| notification_prefs                                                              | JSON NULL                                                                                                                            | `{event:{inapp,email,slack}, _categories:{...}}` (NOTIF)                                                                                     |
| auto_translate_languages                                                        | JSON NULL                                                                                                                            | ISO codes (AR/I18N)                                                                                                                          |
| default_language                                                                | varchar(8) NULL; inbox_translate tinyint default 1; data_residency varchar(16) default 'any'                                         | `any                                                                                                                                         | eu_only | local` translation-provider gate |
| appointment_settings                                                            | longtext NULL, `encrypted:array` cast                                                                                                | APPT                                                                                                                                         |
| timezone                                                                        | varchar(64) NOT NULL default 'UTC'                                                                                                   | canonicalised via `safe_timezone` on read/write; app default written by creators is Asia/Kolkata                                             |
| locale                                                                          | varchar(16) default 'en'; currency varchar(10) NULL; country varchar(8) NULL; industry varchar(64) NULL; size_range varchar(32) NULL | profile                                                                                                                                      |
| auto_pickup_delay_sec (15), voicemail_delay_sec (25), default_voice_ai_agent_id | int / bigint                                                                                                                         | WABA calling tunables (CALL)                                                                                                                 |
| business_hours                                                                  | JSON NULL                                                                                                                            | `{days:{mon..sun:{enabled,from,to}}, outside_action, outside_template_id}`; NULL = always open (TIB2)                                        |
| status                                                                          | tinyint(1) default 1                                                                                                                 | 1 active / 0 suspended (TW-WSP-027/028)                                                                                                      |
| last_active_at                                                                  | timestamp NULL                                                                                                                       | bumped by `switchWorkspace`; switcher ordering                                                                                               |
| skip_onboarding_email, bill_to_platform_credit, pre_seed_sample_data            | tinyint(1) default 0                                                                                                                 | first and third stored only; `bill_to_platform_credit` = BSP reseller billing mode (live)                                                    |
| admin_note                                                                      | text NULL                                                                                                                            | internal note, shown only in admin                                                                                                           |
| deals_auto_from_orders (0), deals_auto_min_minor                                | tinyint / bigint NULL                                                                                                                | sales pipeline opt-in (DEAL)                                                                                                                 |
| wa_copilot_enabled                                                              | tinyint default 0                                                                                                                    | AI copilot staff channel (AICRM)                                                                                                             |
| inbox_away                                                                      | tinyint default 0                                                                                                                    | manual away mode for auto-reply (AR)                                                                                                         |
| data_wiped_at                                                                   | timestamp NULL                                                                                                                       | set by TW-WSP-035                                                                                                                            |
| deleted_at / created_at / updated_at                                            | timestamp NULL                                                                                                                       | soft delete                                                                                                                                  |

### `workspace_user` (pivot; no model; one row per membership; ~ members count)

PK `id`; UNIQUE (workspace_id, user_id); indexes on each. No FKs.

| Column                                                                                                                    | Behavior                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| workspace_id, user_id                                                                                                     | membership                                                                                          |
| role                                                                                                                      | varchar(32) default `'member'` (legacy alias of Agent); values owner, admin, manager, agent, viewer |
| invited_at                                                                                                                | set by invite; NULL for owner rows created at signup                                                |
| joined_at                                                                                                                 | NULL = pending invite; set at first login (TW-WSP-021) or immediately for existing users            |
| created_at, updated_at                                                                                                    |                                                                                                     |
| Written by TW-WSP-001, 003, 016, 017, 018, 034 (and by installer, team-chat invite approval which inserts role `member`). |

### `teams` (model `Team`, soft delete) and `team_user` (pivot)

`teams`: PK id; UNIQUE (workspace_id, slug); index (workspace_id, is_default). Columns: workspace_id, name varchar(64), slug varchar(64), color varchar(16) default '#075E54', description varchar(255) NULL, default_assignee_user_id NULL, assignment_strategy varchar(16) default 'manual' (`manual, round_robin, least_loaded, sticky`), business_hours JSON NULL, timezone NULL, device_ids JSON NULL (NULL/empty = any device), is_default tinyint default 0, sort int default 0, deleted_at. Read/written by TW-WSP-022; consumed by TIB1/TIB2 (`conversations.assignee_team_id`, routing rules).
`team_user`: PK id; UNIQUE (team_id, user_id); columns team_id, user_id, is_lead tinyint default 0, capacity int default 20 (max concurrent conversations per member for load-based assignment), timestamps.

### `workspace_flags` (model `WorkspaceFlag`; low volume)

Columns: workspace_id, flag varchar(32) (`spam, abuse, fraud, billing_overdue, tos_violation, frozen`), reason varchar(500) NULL, flagged_by_user_id, cleared_at, cleared_by_user_id, timestamps. Indexes (workspace_id, cleared_at), workspace_id, flag. Active = `cleared_at IS NULL`. Written by TW-WSP-028.

### `workspace_addons` (model `WorkspaceAddon`; ADD/PLAN domain owns the purchase flow)

Columns: workspace_id, package_id (an add-on `packages` row), order_id NULL, status varchar(16) default 'active', starts_at, ends_at NULL. Active = status active AND (ends_at NULL or in the future). Read by `Workspace::effectiveLimit` (TW-WSP-010) only.

### `impersonation_sessions` (model `ImpersonationSession`; platform audit, append-mostly)

Columns: admin_user_id, target_workspace_id, original_workspace_id NULL, reason varchar(500) NOT NULL, ip varchar(64), user_agent varchar(500), started_at default now, ended_at NULL (open session = NULL), timestamps. Indexes (admin_user_id, ended_at), admin_user_id, target_workspace_id. Written by TW-WSP-032/033.

### `users` (model `User`, soft delete)

See TW-WSP-047. Behavior-relevant columns: name varchar(255), display_name varchar(120), email varchar(255) UNIQUE, locale varchar(12), site_name varchar(255) UNIQUE (legacy), referral_code varchar(16) UNIQUE, referred_by_user_id (FK self, ON DELETE SET NULL), wallet_credits / wallet_currency_minor bigint unsigned default 0, wallet_currency_code varchar(3) default 'INR', mobile varchar(32), country_code varchar(8), address text, city varchar(120), state varchar(60), country varchar(8), zip varchar(24), notes text (admin-only), force_password_change tinyint default 0, welcome_email_sent_at, avatar_path varchar(191) (relative path or social URL), role varchar(255) NOT NULL default 'user', email_verified_at, mobile_verified_at, password varchar(255) (hashed), passcode, password_changed_at, social_provider varchar(20) + social_provider_id varchar(191) (index), two_factor_enabled + two_factor_secret text + two_factor_confirmed_at + two_factor_recovery_codes text (encrypted casts), theme_preference varchar(16) default 'paper', auto_ai_summarize_enabled, remember_token, inbox_last_seen_at, current_workspace_id bigint unsigned NULL (no FK), quick_access JSON, has_seen_intro, sheets_api_key_* (EXT), deleted_at, timestamps. There is NO `phone` and NO `gender` column (both referenced by UI/code). Indexes: email, site_name, referral_code unique; referred_by; sheets_api_key_hash; (social_provider, social_provider_id).

### `user_otps` (model `UserOtp`; AUTH/MOB) and `user_device_tokens` (model `UserDeviceToken`; MOB)

`user_otps`: user_id UNIQUE FK -> users ON DELETE CASCADE, otp varchar(10), expires_at. `user_device_tokens`: user_id, workspace_id NULL, device_id NULL, fcm_token text, token_hash char(64) UNIQUE (sha256 of trimmed token), platform varchar(16), device_info JSON, last_used_at; indexes (workspace_id, device_id), user_id, workspace_id, device_id. Listed here because the hint assigns `User*` models; behavior belongs to AUTH and MOB.

### Channel-mirror tables owned by other domains but modeled as `Workspace*`

- `workspace_email_accounts` (`WorkspaceEmailAccount`; MAIL domain): workspace_id, mailtrixy_account_id (UNIQUE with workspace_id), mtx_workspace_id, mtx_last_message_id (pull cursor), email, name, provider, status default 'connected', synced_at. `hasConnected()` also requires the MailTrixy install to be connected.
- `workspace_ig_accounts` (`WorkspaceIgAccount`; IG domain): workspace_id, instaflow_account_id varchar(64) (UNIQUE with workspace_id), username, name, avatar, status default 'connected' (connected scope = NULL or not 'disconnected'), followers, synced_at. Wiped when the native Instagram add-on folder disappears (`AppServiceProvider` reconcile).
- `workspace_payment_configs` (`WorkspacePaymentConfig`; CHK/PAYGW): workspace_id, provider_config_id, config_name (UNIQUE with workspace_id), payment_type default 'upi' (`razorpay, payu, billdesk, zaakpay` allowed), country default 'IN' (only IN supported), currency default 'INR', merchant_category, is_active, meta_json (encrypted array).

### Referenced, owned elsewhere

`agent_statuses` (TIB2: per user+workspace presence/status; used by the members list), `audit_logs` (NOTIF; layer, workspace_id, actor_user_id, action varchar(64), subject_type/id, payload JSON, result enum success|failure|warning, ip, user_agent), `sessions` (AUTH; used by force logout), `password_reset_tokens`, `packages` (PLAN), `notifications` (NOTIF), Spatie `roles/permissions/model_has_roles` (RBAC), `tags` (starter tags; CON), `system_settings` (SET).

## Cross-domain contracts

**Consumes**

- PLAN: `packages` (limit and feature columns, `free`, `plan_id`, `plan_amount`, `data_retention_days`, `plan_duration`, `plan_unit`, `lifetime`, `is_custom_quote`, `chargeableAmount()`), `PlanLimitGuard::check/feature/hasFeature`, `registration_default_plan_id`, `registration_trial_days`, `billing_plan_scope`, checkout stamping `trial_ends_at`/`plan_ends_at`; `EnsureTrialActive` allow-list for `*workspaces*` routes.
- AUTH: registration steps 1 and 3 and login (pending-invite activation hook lives on the Login event), password reset broker, `EnsureUserActive` (suspended users), email verification (`EmailVerificationController::send`), `SecurityAuditLogger`, `PasswordPolicy`.
- RBAC: Spatie roles/permissions (`Super Admin`, `Admin`, `Platform Support`, `Auditor`, `platform.*` keys), `PlatformPermissions::userCan/isSuperAdmin`, `EnsureUserIsAdmin`, `IPAllowlist`.
- NOTIF: `Audit::log`, `AuditLogger::workspace/platform`, `NotificationHelper` (in-app "Workspace created"), `AuditableObserver`.
- SET: media disk (`media_disk()`, `media_url()`), `SystemSetting` (default_timezone, default_currency, auto_verify_email, users_last_import), mail settings, `FormatSettings`, brand name.
- WADEV/WABA/channel domains: `wa_provider_configs`, `devices`, channel tables consumed by `WorkspaceEngine`.
- TIB1/TIB2: `agent_statuses`, conversations (`assignee_team_id`), routing rules.

**Exposes**

- Tenant context: `users.current_workspace_id` + `Workspace` scope convention (`workspace_id` on every tenant table), `User::switchWorkspace`, `User::workspaceRole`, `ResolveTenantDomain::isTenant()/tenant()`, in-memory override pattern (`setAttribute` + `syncOriginalAttribute`) reused by `ResolveAppWorkspace` (MOB).
- `WorkspacePermissions` (permission keys, `userCan`, `canGrantRole`), `@canWorkspace` Blade directive, `workspace.role:<min>` route middleware (consumed by ~40 routes in TIB1/TIB2/CAMP/BCAST/FLB/INTG/API domains), `TeamPolicy`, `WorkspacePolicy`, `ConversationPolicy` inputs.
- `Workspace::effectiveLimit`, `package()`, `billingPackage()`, `planIsActive()`, `trialExpired()`, `billsToPlatform()`, `isSuspended()`, `isOutsideBusinessHours()`, `wantsNotification()`, `suppressesOurAutoReply()`, `inboundInboxStatus()` (consumed by PLAN, WALLET, BSP, TIB2, AR, NOTIF, WABA).
- `WorkspaceEngine` (`for`, `enginesFor`, `senders`, `parseSenderKey`, `senderForKey`, `ownsSender`, `validDeviceIds`) consumed by WADEV, WABA, BCAST, CAMP, SCHED, TIB1, FLB, FLR, DASH, MOB and channel domains.
- `WorkspaceProvisioner::provision` (MOB signup, MOB create-workspace) and `AdminWorkspaceProvisioner::ensureFor`.
- Events (implicit, model hooks): `workspace.created` (starter tags), audit actions `workspace.entered`, `member.invited|role_changed|removed|password_reset`, `team.created|updated|deleted`, `impersonation.started|stopped`, `workspace.flagged|unflagged|suspended|unsuspended`, `admin.workspace.*`, `admin.user.*`.
- `impersonation_sessions` + `platform_notes` (`PlatformNote`, ASHELL) support the admin team-inbox console (TIB2).
- Routes claimed elsewhere but tied to this domain: `api/app/workspaces` GET/POST, `api/app/workspaces/{id}` GET/PUT (MOB); `api/workspace-attributes/{workspaceId}` (NODE/CON, Node token authed).

## Open questions & quirks

1. **Suspension not enforced.** `workspaces.status=false` and flags `frozen|tos_violation|fraud` are checked only by `EnsureWorkspaceMembership`, whose `workspace.member` alias is attached to no route (TW-WSP-014/027/028). Confirm live with the `threadwise-verify-parity` skill whether a suspended workspace can still use the app. The redirect target `/workspaces/select` does not exist either.
2. **Admin-created workspaces have no owner membership row.** `Admin\WorkspacesController@store` never inserts the `workspace_user` owner row (TW-WSP-024 rule 4), nor do admin-created users get memberships (TW-WSP-038/045). Verify live what the owner sees after first login; this may be a real bug or compensated somewhere not found.
3. **`workspaces.plan` is NOT NULL** but admin create (no plan) and the retention wipe write NULL (TW-WSP-024 rule 5, TW-WSP-035 rule 2). Verify under strict SQL mode.
4. **Plan stored two ways**: package slug (`starter`) at signup/mobile/in-app create vs numeric id at checkout/admin edit; admin list/detail/MRR only understand numeric ids (TW-WSP-023 rule 3, TW-WSP-025 rule 5). The port should normalise to an FK.
5. **`force_password_change` is never enforced** although forms, mails and docs promise it (TW-WSP-047 rule 4, TW-WSP-016, TW-WSP-019, TW-WSP-024, TW-WSP-038).
6. **Docs vs code**: docs say "sort by MRR (default)" (not implemented), "Good / Watch / Risk" health (code: Good/Active/Low/New/Idle/Suspended), "trash recoverable 30 days / auto-delete nightly" for users (only manual empty-trash) and for workspaces (no restore route at all), "suspend blocks normal operation" (unenforced), "reactivate returns the normal role" (always `user`), overrides "entered on the detail page" (no UI), "Pre-seed sample data", "Skip onboarding email", caps (all dead), "SSL auto-provisioned" (nothing does it), "Owner is forced to set password on first login".
7. **Removed/deleted-user state leaks**: removing a member does not clear their `current_workspace_id`, sessions or assignments (TW-WSP-018); trashing an owner leaves an ownerless workspace (TW-WSP-043); force-deleting a user leaves dangling memberships/ownership (TW-WSP-044).
8. **Cross-tenant weak spots**: team `members[]` are not validated as workspace members (TW-WSP-022); an admin resetting a member's password affects all that user's workspaces (TW-WSP-019); an Admin can demote the Owner (TW-WSP-017); a regular platform Admin can edit/trash a Super Admin (TW-WSP-046); `verifyDomain` uses a substring DNS match and never re-verifies after a domain change (TW-WSP-030, 026).
9. **Trashed-user email collisions**: inviting the email of a soft-deleted user 500s (TW-WSP-016); trash search queries the non-existent `users.phone` column (TW-WSP-044).
10. **`UsersController` (non-admin)** named in the assignment hints does not exist; user-facing account management lives in `AccountController` (AUTH/SET domains). `AdminPagesController` still contains unrouted prototype actions (`users`, `userCreate`, `userEdit`, `userImport`, `userTrash`, `workspaces`, `workspaceCreate`, `workspaceDetail`) that return static views (dead code, ignore in the port).
11. `resources/js/charts/workspaces-detail.js` is a prototype with hard-coded April data registered as page key `workspaces-detail` but no view uses that key (dead code).
12. **Platform Support / Auditor roles vs admin gate.** `PlatformPermissions` defines Platform Support (can impersonate/flag) and Auditor, but every `/admin` route also requires `EnsureUserIsAdmin` (Spatie Super Admin/Admin or legacy role column), so users holding only those roles cannot reach the endpoints (RBAC/ASHELL to confirm). Seeded Spatie keys `users.*` and `workspaces.*` are not enforced anywhere in the admin controllers; `users.login_as` has no corresponding per-user impersonation.
13. **Suspended user reach**: `EnsureUserActive` only guards web routes; whether Sanctum mobile tokens, REST API keys and the Node bridge honor `role=suspended` is unverified.
14. Routes in this file claimed by AUTH as well (register/workspace, account/suspended) and by TIB2 (team-inbox teams routes, admin team-inbox suspend/flag) should be settled at merge time; `api/app/workspaces*` stay with MOB, `api/workspace-attributes/{workspaceId}` with NODE.
15. Settings tab routes that mutate `Workspace` columns but were NOT claimed here (belong to SET/NOTIF/I18N/CMS domain writers): `POST settings/branding`, `POST settings/notifications`, `POST settings/data-residency`, `POST settings/appearance`, `POST settings/preferences`, `settings/2fa/*`, `settings/aikeys/*`, `settings/sessions/*`.
16. `workspace_addons` has no purchase code in this domain (ADD/PLAN); `default_engine` is stored but `WorkspaceEngine::for()` ignores it ("later phases may prefer it").
17. Temp-password invites: `TeamInviteMail` and `AdminWelcomeMail` transmit plaintext passwords; `Admin welcome` copy claims a forced first-login change.
18. Timezone default inconsistency: signup uses the `default_timezone` setting, `WorkspacesController@store`/`WorkspaceProvisioner`/admin create use a hard-coded `Asia/Kolkata`, DB default is `UTC`.

## Coverage

```json threadwise-coverage
{
  "routes": [
    "GET register/workspace",
    "POST register/workspace",
    "GET workspaces/create",
    "POST workspaces",
    "POST workspaces/{id}/switch",
    "GET {wsSlug}",
    "POST settings",
    "GET settings/export/{type}",
    "DELETE settings/workspace",
    "GET account/suspended",
    "GET team-inbox/members",
    "GET team-inbox/api/members",
    "POST team-inbox/api/members/invite",
    "PATCH team-inbox/api/members/{userId}/role",
    "DELETE team-inbox/api/members/{userId}",
    "POST team-inbox/api/members/{userId}/reset-password",
    "GET team-inbox/api/teams",
    "POST team-inbox/api/teams",
    "PATCH team-inbox/api/teams/{id}",
    "DELETE team-inbox/api/teams/{id}",
    "GET admin/workspaces",
    "GET admin/workspaces/create",
    "POST admin/workspaces",
    "GET admin/workspaces/{id}",
    "PUT admin/workspaces/{id}",
    "DELETE admin/workspaces/{id}",
    "POST admin/workspaces/{id}/toggle",
    "POST admin/workspaces/{id}/verify-domain",
    "POST admin/workspaces/{id}/overrides",
    "POST admin/team-inbox/api/workspaces/{id}/flag",
    "DELETE admin/team-inbox/api/flags/{id}",
    "POST admin/team-inbox/api/workspaces/{id}/suspend",
    "POST admin/team-inbox/api/workspaces/{id}/unsuspend",
    "POST admin/impersonate/{workspaceId}",
    "POST admin/impersonate/stop",
    "GET admin/users",
    "POST admin/users",
    "GET admin/users/create",
    "GET admin/users/import",
    "POST admin/users/import",
    "GET admin/users/import/template",
    "GET admin/users/trash",
    "POST admin/users/trash/empty",
    "PUT admin/users/{id}",
    "DELETE admin/users/{id}",
    "GET admin/users/{id}/edit",
    "DELETE admin/users/{id}/force",
    "POST admin/users/{id}/force-logout",
    "POST admin/users/{id}/reset",
    "POST admin/users/{id}/restore",
    "POST admin/users/{id}/toggle"
  ],
  "controllers": [
    "app/Http/Controllers/WorkspacesController.php",
    "app/Http/Controllers/WorkspaceMembersController.php",
    "app/Http/Controllers/Admin/WorkspacesController.php",
    "app/Http/Controllers/Admin/ImpersonationController.php",
    "app/Http/Controllers/Admin/UsersController.php"
  ],
  "services": [
    "app/Services/WorkspaceEngine.php",
    "app/Services/WorkspaceProvisioner.php",
    "app/Support/AdminWorkspaceProvisioner.php",
    "app/Support/WorkspacePermissions.php"
  ],
  "models": [
    "Workspace",
    "WorkspaceAddon",
    "WorkspaceEmailAccount",
    "WorkspaceFlag",
    "WorkspaceIgAccount",
    "WorkspacePaymentConfig",
    "Team",
    "User",
    "UserDeviceToken",
    "UserOtp",
    "ImpersonationSession"
  ],
  "tables": [
    "workspaces",
    "workspace_user",
    "workspace_flags",
    "workspace_addons",
    "workspace_email_accounts",
    "workspace_ig_accounts",
    "workspace_payment_configs",
    "teams",
    "team_user",
    "users",
    "user_otps",
    "user_device_tokens",
    "impersonation_sessions"
  ],
  "views": [
    "resources/views/admin/users/create.blade.php",
    "resources/views/admin/users/edit.blade.php",
    "resources/views/admin/users/import.blade.php",
    "resources/views/admin/users/index.blade.php",
    "resources/views/admin/users/trash.blade.php",
    "resources/views/admin/workspaces/create.blade.php",
    "resources/views/admin/workspaces/detail.blade.php",
    "resources/views/admin/workspaces/index.blade.php",
    "resources/views/auth/suspended.blade.php",
    "resources/views/auth/register/step2.blade.php",
    "resources/views/auth/register/_step2_form.blade.php",
    "resources/views/user/team-inbox/members.blade.php",
    "resources/views/user/workspaces/create.blade.php",
    "resources/views/workspace-suspended.blade.php",
    "resources/views/mail/team-invite.blade.php",
    "resources/views/emails/admin-welcome.blade.php"
  ],
  "commands": ["workspaces:wipe-expired"],
  "permissions": [
    "platform.user.suspend",
    "platform.user.view_all",
    "platform.workspace.flag",
    "platform.workspace.impersonate",
    "platform.workspace.suspend",
    "platform.workspace.unflag",
    "platform.workspace.unsuspend",
    "platform.workspace.view_all",
    "users.create",
    "users.delete",
    "users.edit",
    "users.import",
    "users.login_as",
    "users.view",
    "workspaces.create",
    "workspaces.delete",
    "workspaces.edit",
    "workspaces.suspend",
    "workspaces.view"
  ],
  "middleware": [
    "app/Http/Middleware/ResolveTenantDomain.php",
    "app/Http/Middleware/ImpersonationBanner.php",
    "app/Http/Middleware/EnsureWorkspaceMembership.php",
    "app/Http/Middleware/EnsureWorkspaceRole.php"
  ],
  "node_files": [],
  "js_assets": [
    "resources/js/charts/admin-users-form.js",
    "resources/js/charts/admin-users-import.js",
    "resources/js/charts/admin-workspaces-detail.js",
    "resources/js/charts/admin-workspaces-form.js",
    "resources/js/charts/auth-register-step2.js",
    "resources/js/charts/user-team-inbox-members.js",
    "resources/js/charts/users-index.js",
    "resources/js/charts/workspaces-detail.js",
    "resources/js/charts/workspaces-index.js"
  ],
  "misc_files": [
    "app/Mail/TeamInviteMail.php",
    "app/Mail/AdminWelcomeMail.php",
    "app/Policies/TeamPolicy.php",
    "app/Policies/WorkspacePolicy.php"
  ],
  "config_files": [],
  "doc_pages": [
    "Documentation/pages/getting-started/workspaces.html",
    "Documentation/pages/account/team-members.html",
    "Documentation/pages/admin-panel/workspaces.html",
    "Documentation/pages/admin-panel/user-management.html"
  ],
  "feature_map": {
    "TW-WSP-001": ["GET register/workspace", "POST register/workspace"],
    "TW-WSP-002": [],
    "TW-WSP-003": ["GET workspaces/create", "POST workspaces"],
    "TW-WSP-004": [],
    "TW-WSP-005": ["POST workspaces/{id}/switch"],
    "TW-WSP-006": ["GET {wsSlug}"],
    "TW-WSP-007": ["POST settings"],
    "TW-WSP-008": ["GET settings/export/{type}"],
    "TW-WSP-009": ["DELETE settings/workspace"],
    "TW-WSP-010": [],
    "TW-WSP-011": [],
    "TW-WSP-012": [],
    "TW-WSP-013": [],
    "TW-WSP-014": [],
    "TW-WSP-015": ["GET team-inbox/members", "GET team-inbox/api/members"],
    "TW-WSP-016": ["POST team-inbox/api/members/invite"],
    "TW-WSP-017": ["PATCH team-inbox/api/members/{userId}/role"],
    "TW-WSP-018": ["DELETE team-inbox/api/members/{userId}"],
    "TW-WSP-019": ["POST team-inbox/api/members/{userId}/reset-password"],
    "TW-WSP-020": [],
    "TW-WSP-021": [],
    "TW-WSP-022": [
      "GET team-inbox/api/teams",
      "POST team-inbox/api/teams",
      "PATCH team-inbox/api/teams/{id}",
      "DELETE team-inbox/api/teams/{id}"
    ],
    "TW-WSP-023": ["GET admin/workspaces"],
    "TW-WSP-024": ["GET admin/workspaces/create", "POST admin/workspaces"],
    "TW-WSP-025": ["GET admin/workspaces/{id}"],
    "TW-WSP-026": ["PUT admin/workspaces/{id}"],
    "TW-WSP-027": ["POST admin/workspaces/{id}/toggle"],
    "TW-WSP-028": [
      "POST admin/team-inbox/api/workspaces/{id}/flag",
      "DELETE admin/team-inbox/api/flags/{id}",
      "POST admin/team-inbox/api/workspaces/{id}/suspend",
      "POST admin/team-inbox/api/workspaces/{id}/unsuspend"
    ],
    "TW-WSP-029": ["DELETE admin/workspaces/{id}"],
    "TW-WSP-030": ["POST admin/workspaces/{id}/verify-domain"],
    "TW-WSP-031": ["POST admin/workspaces/{id}/overrides"],
    "TW-WSP-032": ["POST admin/impersonate/{workspaceId}"],
    "TW-WSP-033": ["POST admin/impersonate/stop"],
    "TW-WSP-034": [],
    "TW-WSP-035": [],
    "TW-WSP-036": [],
    "TW-WSP-037": ["GET admin/users"],
    "TW-WSP-038": ["GET admin/users/create", "POST admin/users"],
    "TW-WSP-039": ["GET admin/users/{id}/edit", "PUT admin/users/{id}"],
    "TW-WSP-040": ["POST admin/users/{id}/toggle", "GET account/suspended"],
    "TW-WSP-041": ["POST admin/users/{id}/reset"],
    "TW-WSP-042": ["POST admin/users/{id}/force-logout"],
    "TW-WSP-043": ["DELETE admin/users/{id}"],
    "TW-WSP-044": [
      "GET admin/users/trash",
      "POST admin/users/{id}/restore",
      "DELETE admin/users/{id}/force",
      "POST admin/users/trash/empty"
    ],
    "TW-WSP-045": [
      "GET admin/users/import",
      "POST admin/users/import",
      "GET admin/users/import/template"
    ],
    "TW-WSP-046": [],
    "TW-WSP-047": []
  }
}
```
