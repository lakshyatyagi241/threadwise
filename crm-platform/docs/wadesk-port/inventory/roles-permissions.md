---
domain: roles-permissions
code: RBAC
title: Roles, Permissions and Workspace Role Enforcement
wadesk_version: '1.7.0'
sources_read: 74
---

# Roles, Permissions and Workspace Role Enforcement

## Overview

WaDesk has **three independent authorization systems** that are easy to confuse. A rebuild must keep them apart (or deliberately unify them, see Port notes):

1. **Platform roles and permissions (Spatie `laravel-permission`, global).** Tables `roles`, `permissions`, `model_has_roles`, `model_has_permissions`, `role_has_permissions`, guard `web`. A super-admin manages them at `/admin/roles` and `/admin/permissions`. Six roles are seeded (Super Admin, Admin, Manager, User, Platform Support, Auditor) and 101 permission keys (85 admin-console "module.action" keys, see WD-RBAC-002, plus 16 `platform.*` operator keys, see WD-RBAC-003). Only nine of the `platform.*` keys are ever _checked_ in live code (platform inbox, impersonation); the other 92 are catalogue-only: assignable in the role editor, never enforced.
2. **Workspace roles (fixed five-rung ladder, per workspace).** `workspace_user.role` in {owner, admin, manager, agent, viewer} (legacy alias `member` = agent). The role to permission map is a hard-coded PHP constant (`WorkspacePermissions`), NOT stored in the Spatie tables, so the same person can be Manager in one workspace and Viewer in another. It is enforced by (a) a route middleware that requires a minimum role (`workspace.role:manager|admin`), (b) 23 named workspace permissions checked in controllers/policies/blade, and (c) three Laravel policies (Conversation, Team, Workspace).
3. **Legacy `users.role` string.** An older platform flag (`admin`, `A`, `user`, `U`, `owner`, `agent`, `suspended`, plus tolerated `super_admin`/`super-admin`/`platform-admin`). It is what the admin Users screen edits, and it is OR-ed with the Spatie role in every "is this a platform admin" test, with slightly different value lists in each test. It is also how a user is suspended.

Who uses it: the **super-admin / platform staff** (roles and permissions screens, admin console gate, "Super Admin only" emergency actions, platform inbox, impersonation); **workspace owners/admins** (invite members, grant workspace roles); **managers/agents/viewers** (every team-inbox action is filtered through their role); **API clients** (REST API keys and the mobile bearer token act as a user but bypass the role middleware entirely, see WD-RBAC-036).

Main flow end to end: installer seeds the six roles + 101 permissions and promotes the first admin to Super Admin, giving the same user a workspace pivot row of `owner`. On login a user holding one of the three platform roles (Super Admin, Platform Support, Auditor) is redirected to `/admin`, everyone else to a workspace dashboard or the team inbox depending on workspace role. Inside a workspace every gated route runs `EnsureWorkspaceRole` (platform admins bypass), controllers call `WorkspacePermissions::userCan(...)`, conversation actions call the Laravel gate (`ConversationPolicy`), and the front end is told the caller's permission map by `/team-inbox/api/bootstrap` so it can hide buttons the server would reject.

Plan tiers: RBAC itself is not plan-gated, but most role-gated routes are _also_ behind an `EnforcePlanFeature:<key>` middleware (owned by PLAN). Platform admins (Spatie Super Admin/Admin or legacy `users.role` admin) also bypass plan limits, trial expiry and message billing (WD-RBAC-017).

Connections: AUTH (login landing, 2FA policy targets "admin-level roles", suspended users), WSP (members page, invite and remove flows, ownership, workspace suspension), ASHELL (admin console shell, `admin` middleware, IP allowlist, admin Users screen that edits `users.role`), TIB1/TIB2 (every team-inbox endpoint listed in WD-RBAC-028..032, platform inbox), NOTIF (`Audit::log` and `AuditLogger` writers used for the few audited RBAC events; permission keys `audit.view`, `audit.export`), PLAN (plan gates stacked on role gates, admin bypass), INST (seeder run + first Super Admin), MOB and API (no role enforcement, WD-RBAC-036), CORE (Spatie cache store, `AppServiceProvider` registering policies and the `@canWorkspace` directive).

## Feature index

| Id          | Feature                                                                                  | Status      | Priority | Effort | Depends on               |
| ----------- | ---------------------------------------------------------------------------------------- | ----------- | -------- | ------ | ------------------------ |
| WD-RBAC-001 | Platform RBAC data model and seeded roles                                                | implemented | P0       | M      | —                        |
| WD-RBAC-002 | Admin-console permission keys (85 catalogue-only keys)                                   | dead-code   | P2       | S      | WD-RBAC-001              |
| WD-RBAC-003 | Platform-tier permission keys and staff role matrix                                      | partial     | P1       | M      | WD-RBAC-001              |
| WD-RBAC-004 | Workspace permission catalogue and role matrix                                           | implemented | P0       | M      | WD-RBAC-024              |
| WD-RBAC-005 | Roles list screen                                                                        | implemented | P1       | S      | WD-RBAC-001              |
| WD-RBAC-006 | Create role                                                                              | implemented | P1       | S      | WD-RBAC-005              |
| WD-RBAC-007 | Edit role and sync permissions                                                           | implemented | P1       | S      | WD-RBAC-005              |
| WD-RBAC-008 | Duplicate role                                                                           | implemented | P2       | S      | WD-RBAC-007              |
| WD-RBAC-009 | Reassign all users of a role                                                             | implemented | P2       | S      | WD-RBAC-007              |
| WD-RBAC-010 | Delete role (Super Admin lock)                                                           | implemented | P1       | S      | WD-RBAC-005              |
| WD-RBAC-011 | Permissions catalogue screen                                                             | implemented | P1       | S      | WD-RBAC-001              |
| WD-RBAC-012 | Create permission                                                                        | implemented | P1       | S      | WD-RBAC-011              |
| WD-RBAC-013 | Delete permission                                                                        | implemented | P1       | S      | WD-RBAC-011              |
| WD-RBAC-014 | Permission cache and Spatie gate integration                                             | implemented | P1       | S      | WD-RBAC-001              |
| WD-RBAC-015 | Admin console access gate and the unused platform-role middleware                        | partial     | P0       | S      | WD-RBAC-001              |
| WD-RBAC-016 | Platform-staff recognition: login landing, maintenance bypass, admin link                | implemented | P1       | S      | WD-RBAC-001              |
| WD-RBAC-017 | Legacy users.role recognition and platform-admin bypass of plan, trial and billing gates | implemented | P0       | M      | WD-RBAC-015              |
| WD-RBAC-018 | Super Admin-only actions (emergency controls, privileged user roles)                     | implemented | P0       | M      | WD-RBAC-017              |
| WD-RBAC-019 | Platform permission enforcement (platform inbox, flags, suspend, policies)               | implemented | P1       | M      | WD-RBAC-003              |
| WD-RBAC-020 | Impersonation grants Owner and re-verifies the permission                                | implemented | P1       | M      | WD-RBAC-019, WD-RBAC-024 |
| WD-RBAC-021 | Assign a platform role to a staff user                                                   | docs-only   | P1       | M      | WD-RBAC-001              |
| WD-RBAC-022 | Role editor scope, template and description fields                                       | docs-only   | P2       | S      | WD-RBAC-006              |
| WD-RBAC-023 | Role and permission audit trail                                                          | partial     | P1       | S      | WD-RBAC-005              |
| WD-RBAC-024 | Workspace role model, hierarchy and resolution                                           | implemented | P0       | M      | —                        |
| WD-RBAC-025 | Route-level minimum workspace role gate                                                  | implemented | P0       | M      | WD-RBAC-024              |
| WD-RBAC-026 | Workspace role-grant rules and role change                                               | implemented | P0       | M      | WD-RBAC-024              |
| WD-RBAC-027 | Member-management permission gates                                                       | implemented | P0       | S      | WD-RBAC-026              |
| WD-RBAC-028 | Conversation visibility policy                                                           | implemented | P0       | M      | WD-RBAC-004              |
| WD-RBAC-029 | Conversation action gates                                                                | implemented | P0       | M      | WD-RBAC-028              |
| WD-RBAC-030 | Assignment authority: assign versus claim-only                                           | implemented | P0       | M      | WD-RBAC-029              |
| WD-RBAC-031 | Inbox list scoping by view_all_teams                                                     | implemented | P1       | S      | WD-RBAC-028              |
| WD-RBAC-032 | Workspace-setting permission gates in the team-inbox API                                 | implemented | P0       | M      | WD-RBAC-004              |
| WD-RBAC-033 | Permission map exposed to the client and blade                                           | implemented | P1       | S      | WD-RBAC-004              |
| WD-RBAC-034 | Owner-only and owner/admin-only checks outside the permission map                        | implemented | P1       | M      | WD-RBAC-024              |
| WD-RBAC-035 | Role-tier navigation and role-based landing                                              | implemented | P1       | S      | WD-RBAC-024              |
| WD-RBAC-036 | Surfaces with no role enforcement (mobile API, REST API, Node)                           | implemented | P1       | S      | WD-RBAC-025              |
| WD-RBAC-037 | Unenforced workspace permissions and unused policy methods                               | dead-code   | P2       | S      | WD-RBAC-004              |

## Features

### WD-RBAC-001 — Platform RBAC data model and seeded roles

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** —
- **Summary:** WaDesk stores global (not per-workspace) roles and permission keys in the standard Spatie tables and ships a seeder that creates six roles and 101 permissions. The installer runs the seeder and promotes the first admin to Super Admin. The platform (super-admin) roles are independent of, and never used for, workspace roles.
- **Actors & access:** No screen of its own; consumed by every platform check. Seeder runs at install (`InstallController::stepSeedData`) and in `php artisan db:seed` (`DatabaseSeeder` calls it first). Mobile self-registration and mobile social sign-in also assign the `User` role.
- **UX & screens:** None directly. Managed through WD-RBAC-005..013.
- **Endpoints:** None.
- **Data:** Tables (see Data model): `roles` (id, name, guard_name, timestamps; unique on name+guard), `permissions` (same shape), `model_has_roles` and `model_has_permissions` (polymorphic pivots, `model_type` is the User class), `role_has_permissions`. All FKs cascade on delete. Only guard `web` is ever used. Seeded roles: Super Admin (id 1, all 101 keys), Admin (all 101 keys), Manager (42 keys), User (22 keys), Platform Support (9 keys), Auditor (4 keys). Seeded users: the installer user, and (dev seed only) `test@example.com`, are made Super Admin.
- **Rules & edge cases:**
  1. Seeding is idempotent for roles and permissions (find-or-create by name+guard) BUT it then **overwrites** each seeded role's permission set with the defaults (full sync). Re-running the seeder therefore silently wipes any edits an admin made to the six seeded roles.
  2. Super Admin and Admin both receive every key that exists at seed time, including all `platform.*`. Keys created later by an admin are not auto-granted to them.
  3. Manager receives every key whose action part (text after the first dot) is exactly one of view, edit, reply, assign, invoices, export. Because it compares the part after the _first_ dot, `platform.*` keys never match (their action part is like `workspace.view_all`).
  4. User receives every key ending in `.view`. QUIRK: this includes `platform.audit.view` and `platform.billing.view`, so an ordinary user with the `User` role passes the platform audit-view permission check (harmless only because those endpoints also sit behind the admin middleware).
  5. Platform Support gets: platform.workspace.view_all, .impersonate, .flag, .unflag; platform.conversation.view_all, .flag_spam; platform.note.write; platform.audit.view; platform.user.view_all. Auditor gets: platform.workspace.view_all, platform.conversation.view_all, platform.audit.view, platform.user.view_all.
  6. The class constant `PlatformPermissions::MATRIX` differs from the seeder (it omits `platform.workspace.unflag` for Platform Support) and is never read (dead). The seeder is the real source of truth; the constants `ROLES`/`PERMISSIONS` are read.
  7. Web registration does NOT assign any Spatie role; only the mobile API register and mobile social sign-in do (`User`). A user with no Spatie role and `users.role` = user is a plain customer.
  8. Spatie `hasRole('Super Admin')` is by exact role _name_; renaming the role in the editor breaks every check that names it (WD-RBAC-007 quirk).
- **Async & events:** None. Spatie events are disabled (`events_enabled` false).
- **External systems:** None.
- **Settings:** `config/permission.php` (cache 24h, key `spatie.permission.cache`, teams off, wildcard permissions off, permission names not shown in exceptions, gate check method registered).
- **Acceptance criteria:**
  - Given a fresh database, when the installer finishes, then `roles` has six rows and `permissions` has 101 rows and the installing admin user holds only the Super Admin Spatie role.
  - Given the seeder is run twice, when it finishes, then row counts are unchanged and each seeded role's permission set equals the seeded default.
  - Given a role named Manager whose permissions were edited, when the seeder is re-run, then its permissions revert to the 42 defaults.
  - Given a mobile app registration, when it completes, then the new user holds the `User` role and no other Spatie role.
- **Source refs:** database/seeders/RolePermissionSeeder.php, database/seeders/DatabaseSeeder.php, app/Http/Controllers/InstallController.php (stepSeedData, stepCreateAdmin), app/Http/Controllers/Api/App/AuthController.php, app/Support/PlatformPermissions.php, config/permission.php, database/migrations/2026_05_06_050907_create_permission_tables.php, Documentation/pages/admin-panel/roles-permissions.html
- **Port notes:** The target repo already has RBAC v3 (`permission_defs` global, per-org `roles`, `role_grants` with allow/deny + record scope, `user_roles`, cache key with `roles_version`; see docs/architecture/rbac.md and `apps/api/src/kernel/rbac`). WaDesk's platform-tier (staff of the SaaS operator) has no per-org meaning there: put platform staff roles in the admin module (`apps/api/src/modules/admin`) with their own global grant tables, do not overload per-org `role_grants`. Do not port the "re-seed overwrites roles" behaviour; seed defaults once and use migrations for new keys. Register every ported key in `permission_defs` first (see the rbac-permission skill).

### WD-RBAC-002 — Admin-console permission keys (85 catalogue-only keys)

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-RBAC-001
- **Summary:** 85 permission keys shaped like `<module>.<action>` are seeded and can be ticked into roles, but nothing in the application ever checks them. They are a prototype catalogue: holding or lacking them changes nothing. Access to the admin console is decided by the `admin` middleware (WD-RBAC-015), not by these keys.
- **Actors & access:** Visible to platform admins in the role editor and permissions screen. No enforcement anywhere.
- **UX & screens:** Rendered as checkbox groups in `admin/roles/create|edit` and cards in `admin/permissions/index`, grouped by the text before the first dot.
- **Endpoints:** None of their own.
- **Data:** Rows in `permissions`. Catalogue (key: meaning inferred from the name; Manager = keys held by the seeded Manager role; User = keys held by the seeded User role; Super Admin and Admin hold all):

| Module       | Keys                                                                             | Meaning                                                                                  | Manager        | User |
| ------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------- | ---- |
| users        | users.view, users.create, users.edit, users.delete, users.import, users.login_as | admin Users screen CRUD, CSV import, log in as a user                                    | view, edit     | view |
| roles        | roles.view, roles.create, roles.edit, roles.delete                               | this domain's role screens                                                               | view, edit     | view |
| permissions  | permissions.view, .create, .edit, .delete, .manage                               | permission catalogue screens (`.edit` has no screen; `.manage` is a catch-all)           | view, edit     | view |
| workspaces   | workspaces.view, .create, .edit, .delete, .suspend                               | admin Workspaces screen                                                                  | view, edit     | view |
| devices      | devices.view, .create, .edit, .delete, .pair, .disconnect                        | admin devices                                                                            | view, edit     | view |
| packages     | packages.view, .create, .edit, .delete                                           | plans                                                                                    | view, edit     | view |
| campaigns    | campaigns.view, .create, .edit, .delete, .send                                   | campaigns                                                                                | view, edit     | view |
| metaads      | metaads.view, .create, .edit, .delete, .approve, .refund                         | Meta Ads module                                                                          | view, edit     | view |
| templates    | templates.view, .create, .edit, .delete                                          | message templates                                                                        | view, edit     | view |
| flows        | flows.view, .create, .edit, .delete                                              | flow builder                                                                             | view, edit     | view |
| webhooks     | webhooks.view, .create, .edit, .delete                                           | webhooks                                                                                 | view, edit     | view |
| integrations | integrations.view, .create, .edit, .delete                                       | integrations                                                                             | view, edit     | view |
| contacts     | contacts.view, .create, .edit, .delete                                           | contacts                                                                                 | view, edit     | view |
| analytics    | analytics.view, .create, .edit, .delete                                          | analytics                                                                                | view, edit     | view |
| inbox        | inbox.view, inbox.reply, inbox.assign, inbox.export                              | inbox (name-collides with workspace keys of the same spelling but is a different system) | all four       | view |
| billing      | billing.view, billing.invoices, billing.refund, billing.cards                    | billing                                                                                  | view, invoices | view |
| audit        | audit.view, audit.export                                                         | audit log                                                                                | view, export   | view |
| security     | security.view, security.edit                                                     | admin security page                                                                      | view, edit     | view |
| settings     | settings.view, .create, .edit, .delete                                           | platform settings                                                                        | view, edit     | view |
| support      | support.view, .create, .edit, .delete                                            | support desk                                                                             | view, edit     | view |

- **Rules & edge cases:**
  1. Confirmed by grep across app, routes, views, JS and config: none of these strings is referenced outside the seeder and role-editor sample text (three examples `campaigns.send`, `billing.refund`, `audit.export` appear only as help text in the create-permission screen). The only apparent hits (`workspaces.create`, `analytics.view`, `inbox.reply`, `inbox.assign`) are route names or unrelated workspace-permission keys.
  2. Manager total 42 = 17 modules x (view+edit) + inbox 4 + billing 2 + audit 2. User total 22 = 20 `.view` keys + the two `platform.*.view` keys (WD-RBAC-001 rule 4).
  3. Admin sidebar badge counts (`roles`, `permissions`) come from raw row counts of the two tables.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given the seeded catalogue, when an admin opens the permissions screen, then 85 non-platform keys are grouped under 20 module cards (users, roles, permissions, workspaces, devices, packages, campaigns, metaads, templates, flows, webhooks, integrations, contacts, analytics, inbox, billing, audit, security, settings, support).
  - Given a role holds none of these keys, when its members use the admin console, then nothing changes (they are not consulted).
- **Source refs:** database/seeders/RolePermissionSeeder.php, resources/views/admin/permissions/index.blade.php, resources/views/admin/roles/create.blade.php
- **Port notes:** Do not port as enforced capabilities. Either drop, or map only the ones that gain real enforcement into the target's `admin.*` keys (for example `admin.role.manage`, `admin.user.manage`). If a per-module catalogue is wanted in the UI, generate it from the real `permission_defs` instead of a hand-typed list.

### WD-RBAC-003 — Platform-tier permission keys and staff role matrix

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-RBAC-001
- **Summary:** Sixteen `platform.*` keys describe what SaaS operator staff may do across every customer workspace. Nine are enforced in live code (platform inbox, workspace flag/suspend, impersonation, audit view, conversation view); seven are catalogue-only or reachable only through unused policy methods. Three roles carry them: Super Admin (all), Platform Support (9), Auditor (4).
- **Actors & access:** Checked through `PlatformPermissions::userCan` (Spatie `hasPermissionTo`, any exception returns false). Not plan-gated.
- **UX & screens:** Exposed to the platform inbox front end as a `permissions` map from `GET admin/team-inbox/api/bootstrap` (every key in the 16-key constant mapped to true/false) so buttons can be hidden.
- **Endpoints:** See WD-RBAC-019 for the routes that enforce them.
- **Data:** Catalogue with default roles and every enforcement point:

| Key                             | Meaning                                       | Super Admin | Admin | Platform Support | Auditor | Enforced at                                                                                                              |
| ------------------------------- | --------------------------------------------- | ----------- | ----- | ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| platform.workspace.view_all     | see any workspace                             | yes         | yes   | yes              | yes     | WorkspacePolicy::view (policy never invoked; dead)                                                                       |
| platform.workspace.suspend      | freeze a workspace                            | yes         | yes   | no               | no      | AdminTeamInboxController::suspendWorkspace; WorkspacePolicy::suspend (unused)                                            |
| platform.workspace.unsuspend    | unfreeze                                      | yes         | yes   | no               | no      | AdminTeamInboxController::unsuspendWorkspace                                                                             |
| platform.workspace.impersonate  | act inside a workspace as its Owner           | yes         | yes   | yes              | no      | ImpersonationController::start; ImpersonationBanner (live re-check every request); WorkspacePolicy::impersonate (unused) |
| platform.workspace.flag         | add a risk flag to a workspace                | yes         | yes   | yes              | no      | AdminTeamInboxController::flagWorkspace; WorkspacePolicy::flag (unused)                                                  |
| platform.workspace.unflag       | clear a flag                                  | yes         | yes   | yes              | no      | AdminTeamInboxController::clearFlag                                                                                      |
| platform.conversation.view_all  | read any conversation                         | yes         | yes   | yes              | yes     | AdminTeamInboxController::queue and ::show; ConversationPolicy::view shortcut (cross-workspace read)                     |
| platform.conversation.flag_spam | mark a conversation spam                      | yes         | yes   | yes              | no      | AdminTeamInboxController::flagSpam                                                                                       |
| platform.note.write             | write a platform-only note on a conversation  | yes         | yes   | yes              | no      | AdminTeamInboxController::platformNote                                                                                   |
| platform.audit.view             | read the audit log via the platform inbox API | yes         | yes   | yes              | yes     | AdminTeamInboxController::auditLog. QUIRK: also held by the seeded User role                                             |
| platform.user.view_all          | list all users                                | yes         | yes   | yes              | yes     | NOT enforced (catalogue only)                                                                                            |
| platform.user.suspend           | suspend any user                              | yes         | yes   | no               | no      | NOT enforced                                                                                                             |
| platform.role.manage            | manage roles                                  | yes         | yes   | no               | no      | NOT enforced (role screens use the admin middleware)                                                                     |
| platform.permission.manage      | manage permissions                            | yes         | yes   | no               | no      | NOT enforced                                                                                                             |
| platform.billing.view           | see platform billing                          | yes         | yes   | no               | no      | NOT enforced. QUIRK: held by the seeded User role                                                                        |
| platform.system.settings        | change system settings                        | yes         | yes   | no               | no      | NOT enforced                                                                                                             |

- **Rules & edge cases:**
  1. Enforcement is by permission (DB-backed), so editing the Super Admin role's permissions in the role editor can strip its power. The code constants are not consulted at runtime.
  2. A missing key (permission deleted, WD-RBAC-013) makes `hasPermissionTo` throw; the helper swallows it and returns false. Deleting `platform.workspace.impersonate` therefore disables impersonation for everybody including Super Admin.
  3. Not all `platform.*` keys are seeded into the Manager role; Manager has none.
  4. Roles "Platform Support" and "Auditor" are only useful if their holders can reach the admin console, but the console gate is the `admin` middleware which they do not pass (WD-RBAC-015). Design intent and shipped behaviour disagree.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a user with the Auditor role, when they call the platform-inbox queue, then it succeeds; when they call impersonate start, then it returns 403.
  - Given a Platform Support user, when they call workspace suspend, then 403; when they call flag, then it succeeds and writes a flag row.
  - Given the permission `platform.workspace.impersonate` is deleted, when Super Admin starts impersonation, then 403.
- **Source refs:** app/Support/PlatformPermissions.php, app/Http/Controllers/Admin/AdminTeamInboxController.php, app/Http/Controllers/Admin/ImpersonationController.php, app/Http/Middleware/ImpersonationBanner.php, app/Policies/WorkspacePolicy.php, app/Policies/ConversationPolicy.php, database/seeders/RolePermissionSeeder.php
- **Port notes:** Keep this as a small fixed set in the admin module. Enforce them all (the six unenforced ones should gate the future admin users/roles/billing/settings endpoints so the matrix means something). Cache the per-request result; the WaDesk implementation does one DB permission lookup per call.

### WD-RBAC-004 — Workspace permission catalogue and role matrix

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-RBAC-024
- **Summary:** 23 named workspace permissions and a fixed role-to-permission matrix for the five workspace roles. The matrix is a PHP constant, not database rows, and cannot be edited by customers or the super-admin. Every workspace-level capability check in the team inbox resolves through it.
- **Actors & access:** Any workspace member is subject to it. Resolution: the user's role in the target workspace (`workspace_user.role`, `member` aliased to `agent`), then a membership test of the key in that role's list. A user with no role in the workspace (not a member) has no permissions. Platform admins are NOT special-cased here (they bypass only the route middleware, WD-RBAC-025); an admin viewing a workspace they are not a member of has no workspace permissions unless impersonating (WD-RBAC-020).
- **UX & screens:** No management UI (the docs page `Documentation/pages/account/team-members.html` shows the matrix read-only). The role picker on the members page and the invite modal show short role blurbs (Owner: everything including billing; Admin: full workspace access, no billing; Manager: sees all teams, can assign and resolve; Agent: handles assigned conversations; Viewer: read-only).
- **Endpoints:** None of its own; exposed to the client through `GET team-inbox/api/bootstrap` (WD-RBAC-033).
- **Data:** Matrix (Y = granted):

| Key                  | Meaning                                                             | Owner | Admin | Manager | Agent | Viewer |
| -------------------- | ------------------------------------------------------------------- | ----- | ----- | ------- | ----- | ------ |
| inbox.view_all_teams | see queues of teams the user is not in; also delete others' notes   | Y     | Y     | Y       | Y     | -      |
| inbox.view_team      | see conversations assigned to a team the user belongs to            | Y     | Y     | Y       | Y     | Y      |
| inbox.view_assigned  | see conversations assigned to the user                              | Y     | Y     | Y       | Y     | Y      |
| inbox.reply          | send messages, media, catalog, voice notes, AI suggest, run IG flow | Y     | Y     | Y       | Y     | -      |
| inbox.note           | post/delete internal notes                                          | Y     | Y     | Y       | Y     | -      |
| inbox.assign         | assign/reassign/unassign to anyone, attach AI agents                | Y     | Y     | Y       | -     | -      |
| inbox.assign_self    | claim a conversation for oneself only                               | Y     | Y     | Y       | Y     | -      |
| inbox.resolve        | resolve and reopen                                                  | Y     | Y     | Y       | Y     | -      |
| inbox.snooze         | snooze                                                              | Y     | Y     | Y       | Y     | -      |
| inbox.bulk           | bulk actions endpoint                                               | Y     | Y     | Y       | -     | -      |
| inbox.tag            | add/remove labels on a conversation                                 | Y     | Y     | Y       | Y     | -      |
| inbox.priority       | change priority                                                     | Y     | Y     | Y       | -     | -      |
| team.manage          | create/update/delete teams                                          | Y     | Y     | -       | -     | -      |
| tag.manage           | create/delete workspace labels                                      | Y     | Y     | Y       | -     | -      |
| routing.manage       | routing rules and business hours                                    | Y     | Y     | -       | -     | -      |
| sla.manage           | SLA policies                                                        | Y     | Y     | -       | -     | -      |
| savedreply.manage    | saved replies                                                       | Y     | Y     | Y       | -     | -      |
| member.invite        | invite, remove, reset password of members                           | Y     | Y     | -       | -     | -      |
| member.role.assign   | change a member's workspace role                                    | Y     | Y     | -       | -     | -      |
| workspace.settings   | edit workspace settings (only referenced by an unused policy)       | Y     | Y     | -       | -     | -      |
| workspace.billing    | billing (referenced nowhere)                                        | Y     | -     | -       | -     | -      |
| analytics.view       | team-inbox analytics link (blade only)                              | Y     | Y     | Y       | -     | -      |
| integration.manage   | team-inbox webhooks, AI agents, AI keys                             | Y     | Y     | -       | -     | -      |

Counts: Owner 23, Admin 22, Manager 15, Agent 9, Viewer 2.

- **Rules & edge cases:**
  1. Agent was deliberately granted `inbox.view_all_teams` so the "All" tab and the conversation policy agree with the shared queue (a code comment explains that a workspace without teams or assignees otherwise opened to nothing). Consequence: agents can also delete other people's notes (WD-RBAC-029) and see the "All" tab counts for the whole workspace.
  2. Agents get `inbox.assign_self` but not `inbox.assign`; see WD-RBAC-030.
  3. A key not in the map is denied for every role; there is no wildcard, no deny, and no per-user override.
  4. The role string `member` (default in the pivot migration) is treated as `agent`; any other unknown string yields an empty permission list (denies everything).
  5. Blade also references a key `webhook.manage` (a Webhooks card in the team-inbox settings drawer) that exists in no role, so that card is hidden for everybody (WD-RBAC-037).
  6. Two spellings of the same name exist in the Spatie catalogue (`inbox.reply`, `inbox.assign`, `analytics.view`); they are unrelated to this map.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None. (The static "Owner - 28 permissions / Manager - 22 / Agent - 8 / Viewer - 5" labels in the role-template dropdown of the platform role editor are stale marketing text, not derived from this matrix.)
- **Acceptance criteria:**
  - Given a Viewer, when the UI asks for permissions, then only inbox.view_team and inbox.view_assigned are true.
  - Given an Agent, when checking inbox.assign, then false; inbox.assign_self true; inbox.view_all_teams true.
  - Given a Manager, when checking team.manage or sla.manage, then false; tag.manage and savedreply.manage true.
  - Given a pivot role `member`, when resolving permissions, then the result equals the Agent list.
- **Source refs:** app/Support/WorkspacePermissions.php, app/Models/User.php (workspaceRole), Documentation/pages/account/team-members.html, resources/views/user/team-inbox/members.blade.php
- **Port notes:** In the target, map the five workspace roles to per-org preset roles (Owner/Admin/Manager/Agent/Viewer) whose `role_grants` reproduce this matrix, with the Owner preset locked like the Admin preset in docs/architecture/rbac.md. Suggested key names: `inbox.conversation.read`, `.reply`, `.note`, `.assign`, `.assign_self`, `.resolve`, `.snooze`, `.bulk`, `.tag`, `.priority`, `inbox.team.manage`, `inbox.tag.manage`, `inbox.routing.manage`, `inbox.sla.manage`, `inbox.savedreply.manage`, `org.member.invite`, `org.member.role_assign`, `org.settings.manage`, `billing.manage`, `analytics.read`, `inbox.integration.manage`. Replace the three visibility keys with the target's `record_scope` (all / team / own): view_all_teams = `all`, view_team = `team`, view_assigned = `own`. The target allows custom roles per org, which WaDesk does not for workspaces; the fixed five must exist as seeded presets.

### WD-RBAC-005 — Roles list screen

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-RBAC-001
- **Summary:** Super-admin screen listing every platform role with its user count and how much of the permission catalogue it holds.
- **Actors & access:** Platform admins: routes sit in the admin group (`web`, `auth`, `admin`, `ip.allowlist`); `EnsureUserIsAdmin` passes when the user has Spatie role Super Admin or Admin or legacy `users.role` in (`admin`, `A`). 403 otherwise. No per-permission check (`roles.view` is not consulted).
- **UX & screens:** `resources/views/admin/roles/index.blade.php` (layout `x-layouts.admin`, key `roles`, JS `roles-index.js` only toggles the row action menu). Header: breadcrumb, buttons "Manage permissions" (to /admin/permissions) and "Add role". Flash: green status banner from `session('status')`, red error list. KPI strip (4 cards): Total roles (with "N system - M custom"), Total permissions (row count of `permissions`), Users with role (sum of per-role user counts; a user with two roles counts twice), Roles without users (amber). Filter bar: pills All / System / Custom and a "Search roles" input, both **inert** (no behaviour). Table columns: #, Role name (shield icon, subtitle System role / Custom role), Type badge, Users, Permissions (n / total + progress bar rounded percent), Last edited (Y-m-d of `updated_at` or dash), row menu (Edit role; Delete unless role name is exactly Super Admin). Empty state: "No roles defined yet. Create the first role." Footer: "Showing N of N roles" + "Add role" link. Delete uses a confirm dialog (title "Delete role", text says users lose all its permissions and it cannot be undone).
- **Endpoints:**

| Method uri      | Route name        | Controller@action    | Middleware                                   | Request | Response             |
| --------------- | ----------------- | -------------------- | -------------------------------------------- | ------- | -------------------- |
| GET admin/roles | admin.roles.index | RoleController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | none    | HTML view with roles |

- **Data:** Reads `roles` with eager `permissions` and counts `permissions_count`, `users_count`; ordered by id ascending; no pagination (all rows).
- **Rules & edge cases:**
  1. "System" means the name is Super Admin or Admin only. QUIRK: the other four seeded roles (Manager, User, Platform Support, Auditor) render as "Custom" although the docs call them pre-seeded; the docs also say Super Admin is the only locked role.
  2. `users_count` excludes soft-deleted users (soft-delete scope on the User model).
  3. The permissions bar uses count of role permissions divided by total permission rows.
  4. There is no per-role action for duplicate/reassign in this menu; they live on the edit screen (WD-RBAC-008/009).
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None. Admin IP allowlist (`ip.allowlist`, owned by SET/AUTH) can block the whole group.
- **Acceptance criteria:**
  - Given six seeded roles and one user with Super Admin, when a super-admin opens /admin/roles, then 6 rows show in id order and Super Admin has Users = 1 and Permissions = 101 / 101.
  - Given a non-admin logged-in user, when opening /admin/roles, then 403.
  - Given the row of Super Admin, when opening its menu, then only "Edit role" is offered.
- **Source refs:** app/Http/Controllers/RoleController.php, resources/views/admin/roles/index.blade.php, resources/js/charts/roles-index.js, routes/admin.php, components/admin/sidebar.blade.php (badge counts)
- **Port notes:** Home `apps/web/.../admin/roles` + `apps/api/src/modules/admin/roles`. Implement working filter/search (server-side) since WaDesk's are inert. Show `locked` from the role row instead of hard-coding two names.

### WD-RBAC-006 — Create role

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-RBAC-005
- **Summary:** Admin creates a named platform role and ticks the permissions it carries in a grouped matrix.
- **Actors & access:** Platform admins (admin middleware). No `roles.create` check.
- **UX & screens:** `resources/views/admin/roles/create.blade.php`, JS `roles-create.js`. Section 01 "Role details": Role name (required), Scope select (Workspace level / Platform level), Start from template select (Blank, Owner, Manager, Agent, Viewer with stale counts), Description textarea. Section 02 "Assign permissions": live "n / total selected" counter, a header "Select all permissions" checkbox (tri-state via `indeterminate`), and a table of Module / row-level Select all / permission checkboxes (named `permissions[]`, value = the permission name; label shows the full key). Modules = text before first dot, alphabetical; card headings capitalised. Empty state links to "Create one" permission. Header buttons Cancel and "Create role". Validation errors listed in a red box; old input (name, checked permissions) is preserved on error.
- **Endpoints:**

| Method uri             | Route name         | Controller@action     | Middleware                                   | Request             | Response                                                                                                                        |
| ---------------------- | ------------------ | --------------------- | -------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| GET admin/roles/create | admin.roles.create | RoleController@create | Authenticate, EnsureUserIsAdmin, IPAllowlist | none                | HTML                                                                                                                            |
| POST admin/roles       | admin.roles.store  | RoleController@store  | same                                         | name, permissions[] | redirect to index with flash, or JSON `{ok, message:"Role created.", role:{id,name,permissions[]}}` when the request wants JSON |

- **Data:** Inserts `roles` (name, guard `web`), then syncs `role_has_permissions` for the permission names that exist.
- **Rules & edge cases:**
  1. Validation: name required, string, max 191, unique in `roles.name` (uniqueness ignores guard; MySQL collation makes it case-insensitive); `permissions` optional array of strings.
  2. Unknown permission names are silently ignored (looked up by name, missing ones dropped). An empty or absent list creates a role with zero permissions.
  3. The Scope, Template and Description inputs are not read by the server at all (WD-RBAC-022).
  4. Flash text: `Role "<name>" created.`
  5. Permission cache is flushed after creation (WD-RBAC-014). No audit row is written (WD-RBAC-023).
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given name "Sales Lead" and three ticked permissions, when submitting, then the role exists with exactly those permissions and the list shows 3 / 101.
  - Given an existing role named "Manager", when creating "manager", then a validation error on name is shown and nothing is created.
  - Given JSON Accept header, when creating, then the response is 200 with the role payload.
  - Given a submitted permission name that does not exist, when creating, then the role is created without it and no error.
- **Source refs:** app/Http/Controllers/RoleController.php, resources/views/admin/roles/create.blade.php, resources/js/charts/roles-create.js
- **Port notes:** Post-create, bump the org's or platform's `roles_version` equivalent. Validate permission keys against the registry and reject unknown ones (better than WaDesk's silent drop). Add an audit + outbox entry in the same transaction.

### WD-RBAC-007 — Edit role and sync permissions

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-RBAC-005
- **Summary:** Rename a role and replace its permission set with exactly the ticked boxes. Changes apply immediately to everyone holding the role.
- **Actors & access:** Platform admins. No lock on any role: even Super Admin can be renamed or stripped.
- **UX & screens:** `resources/views/admin/roles/edit.blade.php`, JS `roles-edit.js`. Same two sections as create, pre-filled: heading shows "Editing role #id", the role name, "n / total permissions - last edited Y-m-d", a chip with the user count. Save changes button in the header. Danger zone (section 03), hidden entirely when the role name is exactly Super Admin: Duplicate (WD-RBAC-008), Reassign all users with a "To..." role select (WD-RBAC-009), Delete role (WD-RBAC-010). Old input wins over stored values after a validation error.
- **Endpoints:**

| Method uri                | Route name         | Controller@action     | Middleware  | Request             | Response                                                                                 |
| ------------------------- | ------------------ | --------------------- | ----------- | ------------------- | ---------------------------------------------------------------------------------------- |
| GET admin/roles/{id}/edit | admin.roles.edit   | RoleController@edit   | admin group | none                | HTML; 404 for unknown id                                                                 |
| PUT admin/roles/{id}      | admin.roles.update | RoleController@update | admin group | name, permissions[] | redirect to index `Role "<name>" updated.` or JSON `{ok, message:"Role updated.", role}` |

- **Data:** Updates `roles.name` (+updated_at) and fully re-syncs `role_has_permissions`.
- **Rules & edge cases:**
  1. Validation same as create but uniqueness ignores the role's own id.
  2. Full sync: an empty/absent `permissions` array removes every permission from the role.
  3. QUIRK: Super Admin is only protected from deletion. It can be renamed (which breaks every `hasRole('Super Admin')` and `isSuperAdmin` check; the installer user keeps `users.role` = admin so admin access survives but Super-Admin-only actions do not) or stripped of `platform.*` keys (which disables impersonation and the platform inbox for it). No self-lockout guard.
  4. Permission cache flushed after save. Revocation therefore takes effect on the next request for all holders.
  5. Not audited (WD-RBAC-023).
  6. The GET edit page also loads `otherRoles` (all roles except this one, by name) for the reassign select.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given role Manager with 42 keys, when the admin unticks all and saves, then Manager has 0 keys and the list shows 0 / 101.
  - Given a rename to an existing other role's name, when saving, then validation error and no change.
  - Given the Super Admin role, when opening its edit page, then no danger zone is displayed.
  - Given a holder of the edited role, when the next request is made, then the new permission set applies.
- **Source refs:** app/Http/Controllers/RoleController.php, resources/views/admin/roles/edit.blade.php, resources/js/charts/roles-edit.js
- **Port notes:** In the target the locked preset must be enforced in the database (as the Admin preset already is), not by hiding a button; refuse to rename or strip locked roles server-side. Use optimistic locking on the role row (`version`) to avoid two admins overwriting each other.

### WD-RBAC-008 — Duplicate role

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-RBAC-007
- **Summary:** One click clones a role (name plus full permission set, not its users) into a new role and opens it for editing.
- **Actors & access:** Platform admins. Button lives only in the edit page danger zone (hidden for Super Admin), but the route accepts any role id.
- **UX & screens:** Form button "Duplicate" in the danger zone; success lands on the copy's edit page with a green banner `Role duplicated as "<name>". Edit the copy below.`
- **Endpoints:**

| Method uri                      | Route name            | Controller@action        | Middleware  | Request | Response                                 |
| ------------------------------- | --------------------- | ------------------------ | ----------- | ------- | ---------------------------------------- |
| POST admin/roles/{id}/duplicate | admin.roles.duplicate | RoleController@duplicate | admin group | none    | redirect to admin.roles.edit of the copy |

- **Data:** Inserts `roles` (guard copied, default web) and copies all `role_has_permissions` rows.
- **Rules & edge cases:**
  1. New name = `<name> (copy)`; if taken, `<name> (copy 2)`, `(copy 3)`, and so on until free.
  2. Users are not copied.
  3. Writes audit action `admin.role.duplicated` (layer platform, meta `from`, `to` names).
  4. Cache flushed.
- **Async & events:** One audit-log row (NOTIF writer `Audit::log`).
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given role "Sales" (3 perms), when duplicating, then "Sales (copy)" exists with the same 3 perms and 0 users and the edit page opens.
  - Given "Sales (copy)" already exists, when duplicating again, then "Sales (copy 2)".
  - Given the operation, then an audit row `admin.role.duplicated` exists.
- **Source refs:** app/Http/Controllers/RoleController.php, resources/views/admin/roles/edit.blade.php
- **Port notes:** Copy grants including `effect` and `record_scope`; never copy the `is_locked` flag.

### WD-RBAC-009 — Reassign all users of a role

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-RBAC-007
- **Summary:** Moves every user who holds role A onto role B, leaving A empty (intended as a step before deleting A).
- **Actors & access:** Platform admins. UI in the edit page danger zone (hidden for Super Admin); the route accepts any role.
- **UX & screens:** A "To..." select listing all other roles ordered by name (required) and a "Move" button; caption "Move N users to another role". Result banner `N user(s) moved from "A" to "B".`
- **Endpoints:**

| Method uri                     | Route name           | Controller@action       | Middleware  | Request                                                                          | Response                                                                                       |
| ------------------------------ | -------------------- | ----------------------- | ----------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| POST admin/roles/{id}/reassign | admin.roles.reassign | RoleController@reassign | admin group | target_role_id (required, integer, exists roles.id, must differ from the source) | back with status flash, or error on target_role_id "Pick a different role to move users into." |

- **Data:** For each (non-deleted) user holding the source role: remove source, assign target in `model_has_roles`.
- **Rules & edge cases:**
  1. Only that role is swapped; a user's other roles are untouched. A user who already holds the target ends with it once.
  2. Zero users is allowed and reports "0 user(s) moved".
  3. No transaction and no guard against moving the last Super Admin (including the acting admin) off Super Admin. Soft-deleted users keep the old role.
  4. Audit `admin.role.reassigned` (layer platform, result warning, meta from, to, users count).
  5. Cache flushed.
- **Async & events:** One audit row.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given 3 users on role A, when reassigning to B, then all three hold B (and not A) and the banner says 3 users moved.
  - Given target = source, when submitting, then the error message is shown and nothing changes.
  - Given a user with roles A and C, when reassigning A to B, then the user holds B and C.
- **Source refs:** app/Http/Controllers/RoleController.php, resources/views/admin/roles/edit.blade.php
- **Port notes:** Do it in one transaction, refuse when it would leave zero holders of the locked/owner preset, emit an audit + outbox event and bump the roles version.

### WD-RBAC-010 — Delete role (Super Admin lock)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-RBAC-005
- **Summary:** Permanently deletes a role and detaches it from every holder. The only protected role is the one literally named Super Admin.
- **Actors & access:** Platform admins; controller-level guard on name only.
- **UX & screens:** Delete in the row menu (index) and in the danger zone (edit), both behind a confirm dialog ("Delete role X? Users assigned to this role will lose all its permissions. This cannot be undone."). Blocked attempt shows a red error `Super Admin role is system-locked and cannot be deleted.` (error bag key `role`).
- **Endpoints:**

| Method uri              | Route name          | Controller@action      | Middleware  | Request | Response                                                                                                                                |
| ----------------------- | ------------------- | ---------------------- | ----------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| DELETE admin/roles/{id} | admin.roles.destroy | RoleController@destroy | admin group | none    | redirect to index `Role "<name>" deleted.`; JSON `{ok, message, id}`; for Super Admin 422 JSON `{ok:false, message}` or back with error |

- **Data:** Deletes `roles` row; pivots cascade (`model_has_roles`, `role_has_permissions`). Users are not deleted.
- **Rules & edge cases:**
  1. Role with users can be deleted; those users silently lose that role and its permissions.
  2. Admin, Manager, User, Platform Support and Auditor are deletable. Deleting Admin leaves Admin users still admins via legacy `users.role` if that column is set.
  3. No audit row, no reassign prompt.
  4. Cache flushed.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a custom role with 2 users, when deleted, then the role is gone and the 2 users hold no such role.
  - Given the Super Admin role, when a delete is submitted (even by direct request), then it is rejected with the lock message and the role remains.
- **Source refs:** app/Http/Controllers/RoleController.php, resources/views/admin/roles/index.blade.php, resources/views/admin/roles/edit.blade.php
- **Port notes:** Prefer refusing deletion of a role that still has users unless a reassign target is given. Locked flag from the database.

### WD-RBAC-011 — Permissions catalogue screen

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-RBAC-001
- **Summary:** Master list of every permission key grouped by module, with how many roles use each and an orphan indicator.
- **Actors & access:** Platform admins (admin group).
- **UX & screens:** `resources/views/admin/permissions/index.blade.php` (no page JS). Header with "Back to roles" and "Add permission". KPI strip: Total permissions (with module count), Used in roles (distinct permission ids present in `role_has_permissions`), Orphan permissions (total minus used, amber), Last added (name and Y-m-d of the newest `created_at`). Search input and an "All modules" select are **inert** (no script). Grid of cards, two columns on large screens, one per module (text before the first dot, capitalised) with the count; each row shows the key in monospace, an `orphan` chip in amber when used by zero roles, "in N role(s)" and a Delete button with confirm ("Delete permission X? Any role using it loses that capability immediately."). Empty state links to create the first permission.
- **Endpoints:**

| Method uri            | Route name              | Controller@action          | Middleware  | Request | Response |
| --------------------- | ----------------------- | -------------------------- | ----------- | ------- | -------- |
| GET admin/permissions | admin.permissions.index | PermissionController@index | admin group | none    | HTML     |

- **Data:** Reads all `permissions` ordered by name and aggregates `role_has_permissions`.
- **Rules & edge cases:**
  1. Grouping by "text before the first dot": a key without a dot forms its own group named after the whole key. `platform.workspace.view_all` groups under `platform`.
  2. Roles-per-permission counts only roles, never direct user-permission rows (`model_has_permissions`, which the app never writes).
  3. There is no edit screen by design (renaming would detach it from roles).
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given the seeded data, when opened, then 21 module cards render (20 plus platform) with 101 rows and 0 orphans.
  - Given a new permission attached to no role, when opening, then it appears with the amber orphan chip and the orphan KPI is 1.
- **Source refs:** app/Http/Controllers/PermissionController.php, resources/views/admin/permissions/index.blade.php
- **Port notes:** In the target `permission_defs` are code-defined and global; a UI for them is optional. If kept, make it read-only plus a "used by roles" count.

### WD-RBAC-012 — Create permission

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-RBAC-011
- **Summary:** Admin adds a new named capability flag. Creating it grants it to nobody; it appears as a checkbox in the role editor.
- **Actors & access:** Platform admins.
- **UX & screens:** `resources/views/admin/permissions/create.blade.php`, JS `permissions-create.js`. Fields: Module select (13 fixed options: users, roles, permissions, workspaces, metaads, campaigns, devices, inbox, billing, audit, security, settings, support), Action text (hint: lowercase, no spaces), Permission name (required; auto-filled as module.action until the admin edits it by hand), Display label and Description (not stored). Right column: live preview of `module.action`, a `@can('...')` usage sample, naming-convention tip.
- **Endpoints:**

| Method uri                   | Route name               | Controller@action           | Middleware  | Request                | Response                                                                                                             |
| ---------------------------- | ------------------------ | --------------------------- | ----------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| GET admin/permissions/create | admin.permissions.create | PermissionController@create | admin group | none                   | HTML                                                                                                                 |
| POST admin/permissions       | admin.permissions.store  | PermissionController@store  | admin group | name, module?, action? | redirect to index `Permission "<name>" created.` or JSON `{ok, message:"Permission created.", permission:{id,name}}` |

- **Data:** Inserts `permissions` (name, guard `web`).
- **Rules & edge cases:**
  1. Validation pass 1: name required string max 191; module and action optional strings max 64. If the submitted name has no dot and both module and action are non-empty, the stored name becomes `<module>.<action>` (each trimmed). Pass 2: uniqueness of the submitted `name` field against `permissions.name`.
  2. QUIRK: uniqueness is tested on the raw submitted name, not on the composed name. Submitting name "x", module "users", action "view" passes validation and then fails inside the package with an already-exists exception (HTTP 500) because users.view exists.
  3. No lowercase or character-class enforcement despite the UI copy (spaces, capitals, no-dot names such as `superuser` are all accepted; a no-dot name forms its own module group).
  4. Label and description are dropped (no columns exist).
  5. Cache flushed. No audit row.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given module "campaigns" and action "export" with the name auto-filled, when submitting, then `campaigns.export` exists, is orphaned and shows in the catalogue.
  - Given an existing name, when submitting the same name, then a validation error "name has already been taken" style message on the permission name.
  - Given a JSON request, when creating, then the response is 200 with id and name.
- **Source refs:** app/Http/Controllers/PermissionController.php, resources/views/admin/permissions/create.blade.php, resources/js/charts/permissions-create.js
- **Port notes:** Keys are code-defined via migrations in the target (`permission_defs`); if a runtime UI is retained, validate against a strict regex (lowercase dotted segments) and check uniqueness on the final composed key.

### WD-RBAC-013 — Delete permission

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-RBAC-011
- **Summary:** Deletes a permission key from the catalogue; every role that referenced it loses the capability immediately.
- **Actors & access:** Platform admins.
- **UX & screens:** Delete button per permission row with a confirm dialog (see WD-RBAC-011). Success banner `Permission "<name>" deleted.`
- **Endpoints:**

| Method uri                    | Route name                | Controller@action            | Middleware  | Request | Response                                                          |
| ----------------------------- | ------------------------- | ---------------------------- | ----------- | ------- | ----------------------------------------------------------------- |
| DELETE admin/permissions/{id} | admin.permissions.destroy | PermissionController@destroy | admin group | none    | redirect to index or JSON `{ok, message, id}`; 404 for unknown id |

- **Data:** Deletes the `permissions` row; `role_has_permissions` and `model_has_permissions` rows cascade.
- **Rules & edge cases:**
  1. No in-use guard and no protection for seeded or enforced keys. Deleting an enforced `platform.*` key makes the corresponding check fail closed for all users (WD-RBAC-003 rule 2).
  2. The seeder re-creates missing keys on the next seed, and then also resets seeded roles' permission sets.
  3. No audit row.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a permission attached to two roles, when deleted, then both roles no longer list it and the role list counts drop.
  - Given `platform.audit.view` is deleted, when the platform audit endpoint is called by Super Admin, then 403.
- **Source refs:** app/Http/Controllers/PermissionController.php
- **Port notes:** Do not port deletion of code-defined keys. If needed, allow deleting only orphan, non-system keys.

### WD-RBAC-014 — Permission cache and Spatie gate integration

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-RBAC-001
- **Summary:** All role and permission lookups are served from a 24-hour cache that is flushed on every admin mutation, and the package hooks into Laravel's gate.
- **Actors & access:** Internal.
- **UX & screens:** None.
- **Endpoints:** None.
- **Data:** Cache key `spatie.permission.cache`, expiration 24 hours (`config/permission.php`).
- **Rules & edge cases:**
  1. Every controller mutation (store, update, destroy, duplicate, reassign for roles; store, destroy for permissions) calls the registrar's forget-cache step, so changes are visible on the next request. Direct DB edits (or the seeder run outside the app) are not seen until the cache expires or is flushed; the seeder flushes it at start and end.
  2. `register_permission_check_method` is true: the package registers a global "before" gate hook that asks `hasPermissionTo(<ability>)` for every `can()`/`authorize()`. Ability names used by the app's policies (view, reply, note, assign, resolve, snooze, tag, priority, bulk, update, delete) are not permission names, so the hook denies-quietly-then-falls-through to the policies. A future permission whose name equals a policy ability would short-circuit the policy.
  3. Wildcard permissions and teams mode are disabled.
- **Async & events:** None (`events_enabled` false).
- **External systems:** Laravel cache store (file/redis per `.env`).
- **Settings:** `config/permission.php`.
- **Acceptance criteria:**
  - Given a role edit that removes a key, when the next request from a holder is made, then the key is not effective (no waiting for the TTL).
  - Given the cache store is cold, when a check runs, then it reloads from the tables.
- **Source refs:** config/permission.php, app/Http/Controllers/RoleController.php, app/Http/Controllers/PermissionController.php, vendor/spatie/laravel-permission (PermissionRegistrar)
- **Port notes:** Already solved in the target by the `rbac:{orgId}:v{rolesVersion}:u{userId}` cache; add a global version for platform-staff grants. Do not register a global gate hook.

### WD-RBAC-015 — Admin console access gate and the unused platform-role middleware

- **Status:** partial
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-RBAC-001
- **Summary:** Everything under `/admin` (and `/admin/bsp/*`) is protected by the `admin` middleware, which only asks "is this user a platform admin". A second, finer middleware that checks "holds one of the three platform roles" exists but is attached to no route.
- **Actors & access:** Applies to every `/admin/*` request: web session, `auth`, `admin` (EnsureUserIsAdmin), `ip.allowlist` (IPAllowlist, owned by AUTH/SET). Anonymous users are redirected to login by `auth`; authenticated non-admins get 403 with message "Admins only."
- **UX & screens:** Standard 403 page. Admin IP block returns a dedicated 403 view showing the offending IP (allowlist logic is out of scope here).
- **Endpoints:** Group-level, no own routes. `routes/admin.php` is mounted with prefix `admin`, name prefix `admin.`; `routes/bsp.php` uses only (`web`, `auth`, `admin`) for `admin/bsp/*` (no IP allowlist there).
- **Data:** Reads Spatie roles of the user and `users.role`.
- **Rules & edge cases:**
  1. Pass condition (`User::isAdmin`): holds Spatie role Super Admin OR Admin, OR `users.role` is `admin` or `A`. Any exception while reading Spatie tables is swallowed and falls back to the column.
  2. QUIRK / design gap: the `platform.role` middleware (`EnsurePlatformRole`, passes for Super Admin, Platform Support, Auditor; message "Platform access required.") is registered as an alias and referenced in comments but no route uses it. Consequently the Platform Support and Auditor roles, whose whole purpose is limited admin-console access, cannot open any `/admin` page unless their `users.role` is also admin (which then makes them full admins for everything the `admin` gate covers). Only the fine-grained `platform.*` permission checks add any distinction, and those are reachable only through admin-group routes.
  3. There is no per-page permission check in the console: a Manager-role or User-role holder who also has `users.role = admin` sees the entire console (none of the 85 module keys are consulted).
  4. Suspended (`users.role` = suspended) and unverified users are bounced by the global `EnsureUserActive` before the admin gate, except platform admins (WD-RBAC-017).
- **Async & events:** Blocked IP writes an audit row (AUTH/SET domain).
- **External systems:** None.
- **Settings:** `security.ip_allowlist_enabled`, `security.ip_allowlist_cidrs` (SET/AUTH).
- **Acceptance criteria:**
  - Given a user with only the Platform Support Spatie role and `users.role` = user, when they open /admin/users, then 403.
  - Given a user with Spatie role Admin, when they open /admin/roles, then 200.
  - Given a user with `users.role` = A and no Spatie role, when opening /admin/roles, then 200.
  - Given an anonymous visitor, when opening /admin/roles, then redirect to login.
- **Source refs:** bootstrap/app.php, app/Http/Middleware/EnsureUserIsAdmin.php, app/Http/Middleware/EnsurePlatformRole.php, app/Models/User.php (isAdmin), routes/admin.php, routes/bsp.php
- **Port notes:** Build the admin module gate as "has any platform staff role" plus per-endpoint `@RequirePermission('admin.*')` decorators, i.e. what WaDesk intended with `platform.role` but never wired. Decide explicitly whether Platform Support and Auditor are meant to open the console (docs say yes) and give them the read-only subset. Do not carry over the legacy `users.role` fallback.

### WD-RBAC-016 — Platform-staff recognition: login landing, maintenance bypass, admin link

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-RBAC-001
- **Summary:** A user is "platform staff" when they hold Spatie role Super Admin, Platform Support or Auditor. Staff skip workspace onboarding, land in the admin console, see an admin gear in the workspace header, and pass through maintenance mode.
- **Actors & access:** Determined by `PlatformPermissions::userHasPlatformAccess` (has any of the three role names; exceptions return false).
- **UX & screens:** After password login (`POST /login` is `AuthPagesController@login`) and Google/Facebook sign-in (`SocialAuthController`), staff are redirected to `/admin` without creating a workspace or seeing the workspace prompt. An older `AuthController::login` (not routed; dead-code) does the same to `/admin/users` and additionally honours a `next` path that starts with a single slash. The workspace header (`components/user/header.blade.php`) shows a gear link to `/admin` for staff only. Maintenance middleware lets staff through (also while impersonating).
- **Endpoints:** None of its own.
- **Data:** Reads Spatie roles.
- **Rules & edge cases:**
  1. QUIRK: the Spatie role **Admin** and the `users.role = admin` flag are NOT "platform staff" by this test even though the code comments list Admin among them. An Admin-role user with no Super Admin/Support/Auditor role is sent through the customer path after login (workspace creation prompt if they have none, no gear link, blocked by maintenance mode). They still pass the `admin` gate if they type `/admin` (WD-RBAC-015), and `/home` sends any `isAdmin()` user to `/admin`.
  2. Staff with zero workspaces are not forced through `register.workspace`.
  3. For non-staff the landing is workspace-role based (WD-RBAC-035).
  4. Maintenance bypass is by staff role only (not `isAdmin`), so a legacy `users.role = admin` user is shown the 503 page.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** Admin toggle `maintenance_mode` (SET) enables the 503 gate.
- **Acceptance criteria:**
  - Given a Super Admin, when logging in, then the response redirects to /admin and no workspace prompt appears.
  - Given maintenance mode is on and a Platform Support user is signed in, when browsing customer pages, then pages load; a regular member sees 503.
  - Given a customer owner, when viewing the header, then no admin gear is shown.
- **Source refs:** app/Support/PlatformPermissions.php, app/Http/Controllers/AuthController.php (unrouted login), app/Http/Controllers/AuthPagesController.php, app/Http/Controllers/SocialAuthController.php, app/Http/Middleware/Maintenance.php, resources/views/components/user/header.blade.php
- **Port notes:** In NestJS expose `isPlatformStaff` from the token claims (actor kind) rather than querying roles at each call; the login response should carry the landing route (`/admin` vs `/team-inbox` vs `/dashboard`). Include Admin-equivalent roles in "staff" from the start.

### WD-RBAC-017 — Legacy users.role recognition and platform-admin bypass of plan, trial and billing gates

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-RBAC-015
- **Summary:** A legacy string column `users.role` still decides several things: platform-admin recognition (with a different accepted-value list in each place), account suspension, and whether plan limits, trial expiry and message billing are skipped. Platform admins are never blocked by plan or wallet rules.
- **Actors & access:** Enforced in middleware/services for platform admins; suspension applied by an admin from the Users screen (ASHELL).
- **UX & screens:** Admin Users list/edit have a Role select limited to Admin, Owner, User, Agent, Suspended (`Admin\UsersController::roleOptions`). Plan crown, paywall and trial-bar components hide themselves for Spatie Super Admin/Admin or the legacy values admin, A, super-admin, platform-admin. Header role label under the avatar shows the first Spatie role name, else the humanised `users.role`, else "Member".
- **Endpoints:** None of its own (affects all).
- **Data:** `users.role` varchar(255) default `user`. Values seen: `admin` (installer and admin-created admins), `A` (legacy alias), `user`, `U` (used when a workspace invite creates a brand-new user), `owner`, `agent`, `suspended`, and tolerated but never assignable via UI: `super_admin`, `super-admin`, `platform-admin`.
- **Rules & edge cases:** Value lists per check (Spatie = has role Super Admin or Admin unless noted):
  1. `User::isAdmin` and the `admin` middleware, `Checkout` submit permission, `/home` router: Spatie OR `admin`/`A`.
  2. `PlanLimitGuard::bypass` (feature flags and limits), `OverflowBilling::bypass`, `MessageBillingService::bypass` and the owner-based variants `OverflowBilling` and `MessageBillingService::ownerIsAdmin` (used when a Node-bridge call has no session: bypass if the workspace OWNER is an admin): Spatie OR `admin`/`A`.
  3. `EnsureTrialActive::isAdmin` (expired-trial hard gate): Spatie OR `admin`/`A`/`super-admin`/`platform-admin`. The gate fails open on any exception.
  4. `EnsureWorkspaceRole` bypass: `isAdmin()` OR column in (`admin`, `super-admin`, `super_admin`, `platform-admin`). Same list is repeated in `routes/web.php` (`/home`), `TeamInboxController` (history-sync button), `AiCrmController` (`canToggleWa`) and the workspace switcher (create-workspace link).
  5. `EnsureUserActive::isAdmin` (skip suspended and unverified-email redirect): column in (`admin`, `super-admin`, `platform-admin`) only, no Spatie test. A `users.role = 'suspended'` user is redirected to the account-suspended page; an unverified user is redirected to email verification unless the admin toggle `auto_verify_email` is on.
  6. `PlatformPermissions::isSuperAdmin`: column in (`super_admin`, `super-admin`, `platform-admin`) OR Spatie Super Admin (WD-RBAC-018). Plain `admin` is deliberately not enough.
  7. Mobile `Api\App\PaymentGatewayController::requireAdmin`: column `admin` (case-insensitive) OR Spatie **Admin** only; Super Admin without the column is refused.
  8. QUIRK: suspend/reactivate (Admin Users toggle) overwrites the column: suspend sets `suspended`; reactivate always sets `user`, losing any previous value (agent, owner, admin).
  9. Because a platform admin bypasses plan/trial/billing checks, an admin testing their own workspace is never limited or charged.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** `auto_verify_email` (default on) relaxes the unverified redirect.
- **Acceptance criteria:**
  - Given a user with `users.role` = A and no Spatie role, when they exceed a plan limit, then the limit does not apply.
  - Given a `users.role = suspended` customer, when they open any page other than the allowed ones, then redirect to the suspended page.
  - Given a suspended admin reactivated by another admin, then `users.role` becomes `user`.
  - Given a workspace owned by a Super Admin, when the Node bridge triggers an auto-reply with no session, then message billing is skipped for that workspace.
- **Source refs:** app/Models/User.php, app/Http/Middleware/EnsureUserActive.php, app/Http/Middleware/EnsureTrialActive.php, app/Http/Middleware/EnsureWorkspaceRole.php, app/Services/PlanLimitGuard.php, app/Services/OverflowBilling.php, app/Services/MessageBillingService.php, app/Http/Controllers/Admin/UsersController.php, app/Http/Controllers/Api/App/PaymentGatewayController.php, resources/views/components/plan-crown.blade.php, resources/views/components/plan-paywall.blade.php, resources/views/components/trial-bar.blade.php, resources/views/components/admin/header-right.blade.php
- **Port notes:** Collapse to one predicate (`isPlatformStaff` with an `is_platform_admin` flag on the platform-staff table) and replace `users.role` semantics: suspension becomes a `status` column, workspace membership role lives on the membership row. Bypass of billing for admin-owned workspaces should be an explicit workspace flag (`billing_exempt`), not inferred from the owner's role, and must be evaluated in the worker (no session) as well.

### WD-RBAC-018 — Super Admin-only actions (emergency controls, privileged user roles)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-RBAC-017
- **Summary:** A stricter tier above the admin gate: five "nuclear" security actions and any grant, change or suspension of admin/owner accounts require Super Admin. Denied attempts are audited.
- **Actors & access:** `PlatformPermissions::isSuperAdmin` (see WD-RBAC-017 rule 6). Ordinary Admin-role users can reach the routes but are refused inside the controller.
- **UX & screens:** Security page (`admin.security.*`, owned by AUTH/ASHELL) buttons Revoke all sessions, Force password reset for all, Rotate all webhook secrets, Emergency stop sends, Resume sends. On refusal the page reloads with a flash error: "This emergency control requires Super Admin. Your account is missing that role." Admin Users screen shows role-change notices.
- **Endpoints:** (owned by other domains; listed for the gate)

| Method uri                                                    | Route name                            | Controller@action                       | Gate                        |
| ------------------------------------------------------------- | ------------------------------------- | --------------------------------------- | --------------------------- |
| POST admin/security/danger/revoke-sessions                    | admin.security.danger.revoke          | SecurityController@revokeAllSessions    | isSuperAdmin                |
| POST admin/security/danger/force-reset                        | admin.security.danger.reset           | SecurityController@forcePasswordReset   | isSuperAdmin                |
| POST admin/security/danger/rotate-webhooks                    | admin.security.danger.rotate-webhooks | SecurityController@rotateWebhookSecrets | isSuperAdmin                |
| POST admin/security/danger/halt                               | admin.security.danger.halt            | SecurityController@emergencyStopSends   | isSuperAdmin                |
| POST admin/security/danger/resume                             | admin.security.danger.resume          | SecurityController@emergencyResumeSends | isSuperAdmin                |
| POST admin/users, PUT admin/users/{id}, import, status toggle | admin.users.*                         | Admin\UsersController                   | privileged-role guard below |

- **Data:** Reads user roles; writes audit rows.
- **Rules & edge cases:**
  1. Refused danger actions write audit `admin.security.danger_action_denied` (layer platform, result failure, meta route name and reason `requires_super_admin`).
  2. Privileged legacy roles are `admin` and `owner`. Create: a non-super-admin asking for one is silently downgraded to `user` with the error flash "Creating admin/owner accounts requires Super Admin. User was created with the default role." and audit `admin.user.create_privileged_denied`. Update: promoting or demoting to/from a privileged role is reverted (other fields save) with flash "Promoting/demoting admin or owner roles requires Super Admin. Other changes were saved." and audit `admin.user.role_change_denied`; allowed changes audit `admin.user.role_changed` (from, to). CSV import: privileged roles silently downgraded to `user` for non-super-admins. Suspend/reactivate of an admin/owner by a non-super-admin: refused with "Suspending an admin or owner requires Super Admin." and audit `admin.user.suspend_privileged_denied`.
  3. QUIRK: soft-deleting (trashing) a user has no such guard: any admin can trash a Super Admin (only trashing oneself is blocked).
  4. QUIRK: none of this touches Spatie roles; a non-super-admin can still use Reassign (WD-RBAC-009) to move users onto Super Admin, because the roles screens have no super-admin check.
- **Async & events:** Audit rows only.
- **External systems:** None.
- **Settings:** `platform.emergency_send_halt` (system setting toggled by halt/resume; enforced by the send gate in WALLET/CORE).
- **Acceptance criteria:**
  - Given a Spatie Admin who is not Super Admin, when posting to danger/halt, then no halt occurs, a flash error appears and a denied-audit row exists.
  - Given a non-super-admin admin, when editing a normal user's role to `admin`, then the role stays unchanged and other fields are saved.
  - Given a Super Admin, when suspending an admin user, then it succeeds and audit `admin.user.suspended` is written.
- **Source refs:** app/Support/PlatformPermissions.php, app/Http/Controllers/Admin/SecurityController.php, app/Http/Controllers/Admin/UsersController.php, Documentation/pages/admin-panel/roles-permissions.html, Documentation/pages/admin-panel/security.html
- **Port notes:** Model as permissions `admin.security.emergency` and `admin.user.manage_privileged` held only by the locked Super Admin platform role; enforce with `@RequirePermission` and audit denials through the outbox. Close the two gaps (role screens and trash) by applying the same permission.

### WD-RBAC-019 — Platform permission enforcement (platform inbox, flags, suspend, policies)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-RBAC-003
- **Summary:** The cross-workspace "platform inbox" and impersonation start are guarded per action by `platform.*` permissions rather than by role name, and two Laravel policies carry platform shortcuts.
- **Actors & access:** Holder of the named permission (Spatie `hasPermissionTo`, exceptions => false), after the admin gate.
- **UX & screens:** `admin/team-inbox` page (TIB/ASHELL owner) loads `bootstrap` and hides buttons whose permission map value is false.
- **Endpoints:** (routes owned by the platform-inbox owner; listed here for the permission each one demands)

| Method uri                                                        | Route name                      | Controller@action                  | Permission                                                                        |
| ----------------------------------------------------------------- | ------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| GET admin/team-inbox/api/bootstrap                                | admin.team-inbox.api.bootstrap  | AdminTeamInboxController@bootstrap | none (returns the caller's 16-key map plus up to 200 workspaces by last activity) |
| GET admin/team-inbox/api/queue                                    | admin.team-inbox.api.queue      | @queue                             | platform.conversation.view_all                                                    |
| GET admin/team-inbox/api/conversations/{id}                       | admin.team-inbox.api.show       | @show                              | platform.conversation.view_all                                                    |
| POST admin/team-inbox/api/conversations/{id}/note                 | admin.team-inbox.api.note       | @platformNote                      | platform.note.write (body required max 8000, severity info/warn/critical)         |
| POST admin/team-inbox/api/conversations/{id}/spam                 | admin.team-inbox.api.spam       | @flagSpam                          | platform.conversation.flag_spam                                                   |
| POST admin/team-inbox/api/workspaces/{id}/flag                    | admin.team-inbox.api.flag       | @flagWorkspace                     | platform.workspace.flag                                                           |
| DELETE admin/team-inbox/api/flags/{id}                            | admin.team-inbox.api.flag.clear | @clearFlag                         | platform.workspace.unflag                                                         |
| POST admin/team-inbox/api/workspaces/{id}/suspend                 | admin.team-inbox.api.suspend    | @suspendWorkspace                  | platform.workspace.suspend                                                        |
| POST admin/team-inbox/api/workspaces/{id}/unsuspend               | admin.team-inbox.api.unsuspend  | @unsuspendWorkspace                | platform.workspace.unsuspend                                                      |
| GET admin/team-inbox/api/audit                                    | admin.team-inbox.api.audit      | @auditLog                          | platform.audit.view                                                               |
| POST admin/impersonate/{workspaceId}, POST admin/impersonate/stop | admin.impersonate.start / .stop | ImpersonationController            | start needs platform.workspace.impersonate                                        |

- **Data:** Writes workspace flags, workspace `status`, conversation `is_spam`/`inbox_status`, platform notes, audit rows (layer platform).
- **Rules & edge cases:**
  1. Policy shortcuts: `ConversationPolicy::view` returns true immediately for holders of `platform.conversation.view_all` (cross-workspace read); `WorkspacePolicy::view` for `platform.workspace.view_all`. Every other conversation ability (reply, note, assign, ...) ignores platform permissions, so staff cannot write into customer conversations except by impersonating (deliberate: the audit trail then attributes actions to a workspace member).
  2. Suspend sets workspace `status` false and adds a `frozen` flag; unsuspend sets status true and clears active frozen flags. Members of a suspended workspace are bounced (WSP domain).
  3. `WorkspacePolicy::impersonate/suspend/flag` mirror the permissions but nothing calls them (WD-RBAC-037).
  4. Refusals are plain 403 with no audit row (contrast WD-RBAC-018).
- **Async & events:** Audit rows via `AuditLogger::platform`: `platform_note.added`, `workspace.flagged`, `workspace.unflagged`, `conversation.spam_flagged`, `workspace.suspended`, `workspace.unsuspended`, `impersonation.started`, `impersonation.stopped`.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given an Auditor, when calling the queue, then 200; when posting a note, then 403.
  - Given a Platform Support user (with console access), when calling suspend, then 403; flag, then 200 and a flag row.
  - Given a Super Admin, when suspending a workspace, then its status is false, a frozen flag exists and audit `workspace.suspended` is written.
- **Source refs:** app/Http/Controllers/Admin/AdminTeamInboxController.php, app/Http/Controllers/Admin/ImpersonationController.php, app/Policies/ConversationPolicy.php, app/Policies/WorkspacePolicy.php, resources/js/charts/admin-team-inbox-index.js
- **Port notes:** Put under `apps/api/src/modules/admin/platform-inbox` behind `@RequirePermission('admin.workspace.suspend')` etc. Cross-tenant reads must run in a dedicated privileged DB role/session that bypasses RLS explicitly and is audited; never widen the tenant `app.org_id` setting.

### WD-RBAC-020 — Impersonation grants Owner and re-verifies the permission

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-RBAC-019, WD-RBAC-024
- **Summary:** While a platform admin impersonates a workspace, their workspace role resolves to Owner for that workspace only, so they can operate it fully; the permission is re-checked on every request and the override is never saved to their user row.
- **Actors & access:** Holder of `platform.workspace.impersonate` who is also through the admin gate (start route is under `/admin`).
- **UX & screens:** Start from the admin platform inbox with a mandatory reason; a banner shows target workspace, reason and start time in the workspace shell; Stop button. Redirect after start goes to `/team-inbox` with "Now viewing as <name>."
- **Endpoints:** as listed in WD-RBAC-019 (start body: `reason` required, string, min 8, max 500).
- **Data:** `impersonation_sessions` (admin_user_id, target_workspace_id, original_workspace_id, reason, ip, user_agent, started_at, ended_at) owned by ASHELL/WSP.
- **Rules & edge cases:**
  1. `User::workspaceRole()` returns the real pivot role first; only if the user has no pivot row in that workspace AND an active impersonation session (bound to the current browser session id, targeting that workspace) exists does it return `owner`. The active-target lookup is memoised per request.
  2. The banner middleware applies the target workspace in memory only and re-baselines the attribute so incidental saves cannot persist it. If the admin lost the impersonate permission mid-session the session is force-ended and the request continues on their own workspace.
  3. `EnsureWorkspaceMembership` lets an impersonating admin through even though they are not a member; without an active session the admin is moved to their first real workspace.
  4. Starting a new session ends any earlier open session of the same admin.
  5. Because the start route is in the admin group, a Platform Support user without admin gate cannot start it (WD-RBAC-015).
  6. Other tabs/devices of the same admin account are not affected (key held in the session).
- **Async & events:** Audit `impersonation.started` (payload reason, session id) and `impersonation.stopped` (duration, per-module action counts from the audit log in the window).
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given an admin impersonating workspace W, when calling an inbox action needing member.role.assign, then it succeeds (Owner).
  - Given the impersonate permission is revoked during a session, when the next request arrives, then the session is ended and W data is no longer visible.
  - Given a second browser session of the same admin, then it is not impersonating.
- **Source refs:** app/Models/User.php (workspaceRole, isImpersonatingWorkspace), app/Http/Middleware/ImpersonationBanner.php, app/Http/Middleware/EnsureWorkspaceMembership.php, app/Http/Controllers/Admin/ImpersonationController.php
- **Port notes:** Implement as a short-lived signed impersonation token that carries `{staff_id, target_org_id, session_id}`; the guard then sets the tenant to the target org and grants the Owner preset's grants for that request only. Re-check the staff permission and session validity on each request.

### WD-RBAC-021 — Assign a platform role to a staff user

- **Status:** docs-only
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-RBAC-001
- **Summary:** The docs say a role from the Roles screen is given to an actual staff account on the User Management page. No such control exists: the Users screen edits only the legacy `users.role` string. Spatie roles are only ever attached by the installer (Super Admin), the mobile register/sign-in (User), and the Reassign action (WD-RBAC-009).
- **Actors & access:** n/a.
- **UX & screens:** `admin/users/create|edit` offer Role = Admin / Owner / User / Agent / Suspended (labels for `users.role`), plus workspace select; no Spatie role picker. Users list filters by the same legacy values.
- **Endpoints:** none exist.
- **Data:** `model_has_roles` is written only by the code paths above; `model_has_permissions` is never written.
- **Rules & edge cases:**
  1. Practical consequence: to create Platform Support or Auditor staff an operator has to reassign an existing role's users to it, or edit the database.
  2. Docs also say "Every user has exactly one platform-level role" and describe reactivate flipping "between normal role and Suspended"; the code's reactivate resets to `user`.
  3. Multiple Spatie roles per user are possible in data (nothing prevents it) and permissions union.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given the target product, when a super-admin edits a staff user, then a platform role select lists the platform roles and saving assigns exactly that role (new behaviour; WaDesk has no working path).
- **Source refs:** Documentation/pages/admin-panel/user-management.html, Documentation/pages/admin-panel/roles-permissions.html, app/Http/Controllers/Admin/UsersController.php, resources/views/admin/users/edit.blade.php
- **Port notes:** Build it: a staff-user screen with a role multi-select bound to the platform grants table, guarded by `admin.role.assign`. Keep customer-workspace membership separate.

### WD-RBAC-022 — Role editor scope, template and description fields

- **Status:** docs-only
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-RBAC-006
- **Summary:** The create/edit role forms show Scope (workspace or platform), Start-from-template and Description fields, and the permission form shows Display label and Description, but the server ignores all of them.
- **Actors & access:** Platform admins.
- **UX & screens:** Selects and textareas as described in WD-RBAC-006 and WD-RBAC-012. The edit form always shows Scope = Workspace level regardless of the role. Template options (Owner 28, Manager 22, Agent 8, Viewer 5 permissions) have no script and no server support and the counts do not match the workspace matrix (23/15/9/2).
- **Endpoints:** none of their own.
- **Data:** No columns exist for description, scope, label.
- **Rules & edge cases:** The official docs already state that only the ticked boxes are saved and that scope/template are "convenience helpers", which overstates the template (nothing pre-ticks).
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a submitted template or scope value, when saving, then no extra data is stored (parity); in the port, either implement them or omit the fields.
- **Source refs:** resources/views/admin/roles/create.blade.php, resources/views/admin/roles/edit.blade.php, resources/views/admin/permissions/create.blade.php, resources/js/charts/roles-create.js
- **Port notes:** Decide deliberately: keep `description` (useful, add a column), implement "start from template" as copying an existing role's grants, drop scope.

### WD-RBAC-023 — Role and permission audit trail

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-RBAC-005
- **Summary:** Only two of the eight role/permission mutations write an audit row; the docs promise that granting sensitive roles is audited.
- **Actors & access:** Audit rows are visible in the platform audit log (NOTIF).
- **UX & screens:** None here.
- **Endpoints:** None.
- **Data:** `audit_logs` rows (layer, action, actor, workspace, subject, payload, result, ip, user agent).
- **Rules & edge cases:** Audited: role duplicated (`admin.role.duplicated`), roles reassigned (`admin.role.reassigned`, result warning), user role change on the Users screen, the denied privileged attempts (WD-RBAC-018), workspace member role change (`member.role_changed`, payload has the new role only, not the previous), member invited, removed, password reset, impersonation start/stop, platform inbox actions. NOT audited: role create, role update (rename, permission sync), role delete, permission create, permission delete, Spatie role assignment on install/mobile register.
- **Async & events:** `AuditLogger` writes synchronously and swallows failures.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a role's permissions edited, when audit is queried, then (parity) no entry exists; (target) an entry with before/after key sets is expected.
- **Source refs:** app/Http/Controllers/RoleController.php, app/Http/Controllers/PermissionController.php, app/Support/Audit.php, app/Services/Inbox/AuditLogger.php, app/Http/Controllers/WorkspaceMembersController.php
- **Port notes:** In the target emit `role.created|updated|deleted`, `permission.*` and `role_grant.changed` through the transactional outbox with before/after in the same transaction as the change, and include the previous role on member role changes.

### WD-RBAC-024 — Workspace role model, hierarchy and resolution

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** —
- **Summary:** A user's authority inside a workspace is a single role string on the workspace membership row. Five roles form a strict ladder used for hierarchy checks; a legacy alias maps onto Agent for permission lookup.
- **Actors & access:** Every workspace member. Role source: `workspace_user.role` for (user, workspace). The "current workspace" is `users.current_workspace_id` (session-level switch via the header), overridden per request for mobile (`X-Workspace-Id`) and API keys.
- **UX & screens:** Role names appear as filter chips, badges and selects on `user/team-inbox/members.blade.php` (WSP owner) and in the invite modal; see WD-RBAC-026.
- **Endpoints:** None of its own.
- **Data:** `workspace_user` (id, workspace_id, user_id, `role` varchar(32) NOT NULL default `member`, invited_at, joined_at, timestamps; unique (workspace_id, user_id)). Ranks: owner 100, admin 80, manager 60, agent 40, viewer 20.
- **Rules & edge cases:**
  1. `workspaceRole(ws)`: returns the pivot role if present; else `owner` if an impersonation session for that workspace is active in this browser session (WD-RBAC-020); else null (not a member => no permissions, `EnsureWorkspaceRole` redirects).
  2. The role column is free text; only the invite and role-change endpoints validate against the five names. Every code path that creates a membership sets the role explicitly: registration and in-app workspace creation, both provisioners, the installer and the admin console set `owner`; invites set the chosen role.
  3. The first (creating) user is `owner` and also stored as `workspaces.owner_user_id`. There can be several pivot Owners but only one `owner_user_id`; some checks use the pivot role (permission map, route gates) and some use the column (WD-RBAC-034). Demoting the creator's pivot role does not change `owner_user_id`.
  4. Legacy `member` is aliased to Agent by `permissionsFor`, `roleHasPermission` and `userCan`, and is shown as agent in the members page counts. QUIRK: `EnsureWorkspaceRole` and the nav tier lookup do not alias it: hierarchy rank is 0, so every role-gated route denies it (a 403, not the agent redirect), while the top navigation falls to the default tier and shows the full admin nav.
  5. `workspaceRole()` runs a query on every call (no per-request memo except impersonation targets); pages call it many times.
  6. Hierarchy compare of unknown roles yields rank 0 (lowest).
  7. Mobile membership additionally requires `joined_at` not null; web membership tests only existence.
  8. The same person can hold different roles in different workspaces; switching workspace changes authority immediately.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a user who is Manager in workspace A and Viewer in B, when the current workspace is B, then permission checks use Viewer.
  - Given a pivot role `member`, when checking `inbox.reply`, then true; when opening a manager-gated route, then 403.
  - Given a user not in workspace W, when checking any workspace permission for W, then false.
- **Source refs:** app/Support/WorkspacePermissions.php, app/Models/User.php, app/Http/Middleware/EnsureWorkspaceRole.php, app/Http/Middleware/ResolveAppWorkspace.php, app/Http/Controllers/AuthController.php (storeWorkspace), app/Services/WorkspaceProvisioner.php, app/Support/AdminWorkspaceProvisioner.php, app/Http/Controllers/WorkspacesController.php, database/migrations (workspace_user)
- **Port notes:** Target `user_roles` are per org; membership + role live in `apps/api/src/modules/identity` (existing). Keep `owner` as the locked preset and store the primary-owner marker as a boolean/`owner_user_id` intentionally, and decide once whether "owner-only" checks mean "has Owner preset" or "is the primary owner". Cache per request.

### WD-RBAC-025 — Route-level minimum workspace role gate

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-RBAC-024
- **Summary:** Whole feature areas are locked to Manager-or-above or Admin-or-above with a route middleware (`workspace.role:manager` / `workspace.role:admin`). 462 route definitions use it; agents and viewers who hit them are redirected to the team inbox.
- **Actors & access:** Any authenticated user. Pass rules in order: unauthenticated => redirect to login; platform admin (`isAdmin()` or legacy column in admin/super-admin/super_admin/platform-admin) => pass; no role in current workspace => if the user has zero workspaces redirect to `register.workspace` else redirect to `/team-inbox`; role rank >= required rank => pass; below the bar: Agent or Viewer => redirect to `/team-inbox` with flash warning "Your role (<role>) doesn't have access to that page."; anyone else (a Manager failing an admin gate, or legacy `member`) => 403 with the same text.
- **UX & screens:** Warning banner on the team inbox for redirected agents/viewers; 403 page for managers. Stacked gates: many routes also carry `EnforcePlanFeature:<key>` (PLAN); `ai-crm/settings` carries both manager and admin (effective admin).
- **Endpoints:** Gate matrix (first URL segment; count = routes carrying it):

| Minimum role | Prefixes (route counts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| manager      | dashboard (1), analytics incl. export (2), chat (22), contacts (16), contact-groups (4), lead-finder (9), message-history (3), scheduled (11), templates (23), wa-calling (12), ai-crm index/message/reset (3), ai-usage (1), api/upload-media (1), account/subscription/cancel POST (1), team-inbox/analytics/team + /ai-agents (2), team-inbox/api/duplicates scan + merge (2), team-inbox/sla page + store/update/destroy (4), team-inbox/sync-history (1)                                                                                                                                           |
| admin        | activity-log (3), ai-assistants (7), ai-training (12), ai-crm/settings (1), appointments (16 of 17), auto-reply (11), broadcasts (9), call-logs (3), catalog (16), chatbot-widgets (7), devices (44), flows (41), google-account (2) + api/google/picker (1), hubspot (3 of 4), integrations index (1), invoices (10), meta-ads (22), payments (2), shopify (7 of 10), slack (4), social (4), store (41), team-inbox/members page (1), trello (5), wa-campaigns (16), wa-forms (10), wa-links (6), waba-groups (8), webhooks (19 of 31), woocommerce (9 of 10), workspaces/create + POST workspaces (2) |

Counts total 343 admin + 119 manager = 462. Routes deliberately left un-gated inside those prefixes are OAuth callbacks, public inbound webhooks and public booking pages.

- **Data:** Reads role from `workspace_user` (WD-RBAC-024).
- **Rules & edge cases:**
  1. QUIRK (real gap): navigation tiers hide many "admin" pages from lower roles but the routes themselves carry no role gate: deals (14 routes), crm (6), companies (6), tasks (5), projects (4), proposals (6), estimates (6), calendar, developers/REST API keys (4), warmer (2), attributes (5), team-chat, notifications (6), support (4), guidebook (3), sms (4), telegram (24), line (21), viber (14), wechat (14), tiktok (14), facebook (36), most `settings/*`, and most `team-inbox/api/*`. Any workspace member, including a Viewer, can call these URLs directly. Notable consequence: a Viewer can create the workspace's REST API key (`POST developers/keys`), which then acts as that user with no role check (WD-RBAC-036).
  2. Other nav/route mismatches: `/scheduled` is admin-tier in the nav but manager on the route; `/wa-links` is manager-tier in the nav but admin on the route (manager clicks and gets 403); `team-inbox/members` is admin on both.
  3. The middleware is per-route, not per-controller: the gate protects the page and its XHR only when each route carries it (for `webhooks`, 12 of 31 routes are open because they are public inbound hooks).
  4. Manager gate on SLA routes is stacked with the `sla.manage` permission check in the controller, which Manager lacks: a Manager can open the SLA page but every write returns 403 (WD-RBAC-032).
  5. Suspended workspace handling and trial gating are separate middleware (WSP, PLAN).
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given an Agent, when opening /dashboard, then redirect to /team-inbox with the role warning flash.
  - Given a Manager, when opening /devices, then 403 with the role message.
  - Given a Spatie Admin who is not a member of the workspace, when opening /devices, then it loads (bypass).
  - Given a user with no workspace, when opening /contacts, then redirect to workspace creation.
  - Given a Viewer, when calling POST developers/keys, then it succeeds (parity gap; the port should gate it).
- **Source refs:** app/Http/Middleware/EnsureWorkspaceRole.php, routes/web.php, bootstrap/app.php (alias), app/Support/UserNav.php, resources/views/components/user/header.blade.php
- **Port notes:** Implement as a decorator `@RequireWorkspaceRole('manager')` or, better, translate each area to real permission keys (`contacts.read`, `devices.manage`, ...) so it is not order-of-roles based. Fix the un-gated areas listed in rule 1 rather than porting the gap: each needs an explicit permission owned by its feature domain, and the WD entries of those domains should reference this list.

### WD-RBAC-026 — Workspace role-grant rules and role change

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-RBAC-024
- **Summary:** Who may hand out which workspace role, applied to both inviting a member and changing an existing member's role, plus the inline role editor on the members page.
- **Actors & access:** Actor needs `member.role.assign` (Owner, Admin) to change a role and `member.invite` (Owner, Admin) to invite; then `canGrantRole` on the target role. Owner role: granting Owner or Admin requires the actor to be Owner. Manager, Agent, Viewer: actor needs member.role.assign or member.invite and rank >= target (so Admin and Owner can grant these three). Nobody without a role in the workspace can grant anything. Impersonating admins count as Owner.
- **UX & screens:** `/team-inbox/members` (admin gate): table with a role select per member if the caller holds `member.role.assign`, else a read-only role pill; role filter chips (All, Owners, Admins, Managers, Agents, Viewers) with counts (legacy `member` counted as Agent); toast "Role updated." or "Update failed: <message>" then reload. The members-page invite modal lists Agent, Manager, Admin, Viewer always, plus Owner if the viewer holds `member.role.assign`; the invite modal inside the team-inbox drawer lists only the roles from `grantableRolesFor` (default Agent) with helper "You can change this later from the members list."
- **Endpoints:**

| Method uri                                 | Route name                        | Controller@action                     | Middleware   | Request                                                  | Response                                                                                                                                                                                                |
| ------------------------------------------ | --------------------------------- | ------------------------------------- | ------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PATCH team-inbox/api/members/{userId}/role | user.team-inbox.api.members.role  | WorkspaceMembersController@updateRole | Authenticate | role (required, one of owner,admin,manager,agent,viewer) | `{ok:true}`; 403 (no permission, or cannot grant that role, message "You don't have permission to grant the <role> role."), 422 (invalid role, or changing own role "You cannot change your own role.") |
| GET team-inbox/api/members                 | user.team-inbox.api.members.index | WorkspaceMembersController@index      | Authenticate | none                                                     | members ordered by role then name, plus `roles` (all five) and `grantable_roles` (caller-specific)                                                                                                      |

- **Data:** Updates `workspace_user.role` and `updated_at`; audit row `member.role_changed` (actor, workspace, subject user, payload role = new role).
- **Rules & edge cases:**
  1. Grantable sets: Owner => all five; Admin => manager, agent, viewer; Manager, Agent, Viewer => none.
  2. QUIRK / gap: only the NEW role is checked, never the target's CURRENT role. An Admin can therefore demote an Owner or another Admin (to manager/agent/viewer), including the workspace creator, since 'grantable' checks pass. Docs claim "no one can sneak in a role they are not entitled to give" but do not cover demotion.
  3. Own-role change is blocked (422); the members page still renders the select on the caller's own row.
  4. No check that the target is a member of this workspace: the update simply matches zero rows, returns ok and still writes an audit row.
  5. QUIRK: the members-page select lists all five roles (the API's `grantable_roles` is returned but unused by that script), so an Admin sees Owner and Admin and gets a 403 toast when picking them; the docs claim the dropdown offers only grantable roles.
  6. No cache; the new role applies on the target's next request.
  7. Removing the last Owner is not prevented for Owner-to-Owner changes other than self.
- **Async & events:** Audit row only. No notification to the affected member.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given an Admin, when granting Admin or Owner to a member, then 403 with the grant message; granting Manager succeeds and audits.
  - Given an Owner, when changing their own role, then 422.
  - Given a Manager, when calling the endpoint, then 403.
  - Given an Owner, when granting Owner, then it succeeds.
  - Given the port, when an Admin tries to change an Owner's role, then it must be refused (fix of the WaDesk gap; parity would allow it).
- **Source refs:** app/Support/WorkspacePermissions.php (canGrantRole, grantableRolesFor), app/Http/Controllers/WorkspaceMembersController.php, resources/views/user/team-inbox/members.blade.php, resources/js/charts/user-team-inbox-members.js, resources/views/user/team-inbox/index.blade.php (invite modal), Documentation/pages/account/team-members.html
- **Port notes:** Map onto `apps/api/src/modules/identity` role assignment with a guard "actor rank must be greater than or equal to both the target's current role and the requested role, and only Owner may grant/revoke Owner or Admin". Enforce a minimum of one Owner per org in the database. Return only grantable roles to the UI and use them.

### WD-RBAC-027 — Member-management permission gates

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-RBAC-026
- **Summary:** The permission and hierarchy checks around inviting, removing and resetting the password of workspace members. The invite/remove/reset flows themselves (temp passwords, email) belong to WSP.
- **Actors & access:** `member.invite` (Owner, Admin) for invite, remove and reset-password; `canGrantRole` for the role chosen at invite; seat limit `user_seat_limit` (plan, PLAN) checked before validation with the current pivot row count.
- **UX & screens:** Members page buttons are drawn from the caller's permission map: "Invite teammate" needs `member.invite`, reset-password and remove icons need `member.invite`, role select needs `member.role.assign`. The team-inbox settings drawer shows the invite card only with `member.invite`.
- **Endpoints:**

| Method uri                                          | Route name                                 | Controller@action                        | Middleware   | Gate                                                                                                                                            |
| --------------------------------------------------- | ------------------------------------------ | ---------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| POST team-inbox/api/members/invite                  | user.team-inbox.api.members.invite         | WorkspaceMembersController@invite        | Authenticate | member.invite (403 "You do not have permission to invite members."), seat limit, then role validation and canGrantRole                          |
| DELETE team-inbox/api/members/{userId}              | user.team-inbox.api.members.destroy        | WorkspaceMembersController@destroy       | Authenticate | member.invite; 422 removing self; 422 removing `workspaces.owner_user_id`                                                                       |
| POST team-inbox/api/members/{userId}/reset-password | user.team-inbox.api.members.reset-password | WorkspaceMembersController@resetPassword | Authenticate | member.invite; 404 if target not a member; 403 if target is the workspace owner_user_id and the actor cannot grant Owner (i.e. is not an Owner) |

- **Data:** `workspace_user`, `team_user` (removed member is also removed from the workspace's teams), audit rows `member.invited`, `member.removed`, `member.password_reset`.
- **Rules & edge cases:**
  1. QUIRK / gap: removal and password reset have no hierarchy check beyond the primary owner. An Admin can remove another Admin or a secondary Owner and can reset their password (receiving the temporary password), i.e. a takeover path for any account below the creator.
  2. Only the row in `workspace_user` is deleted on removal; the user's `current_workspace_id` is repaired lazily on their next request by the membership middleware.
  3. Listing members (GET members index) needs no permission: any member (even Viewer) can read the roster with names, emails, roles and presence.
  4. Owner cannot be removed even by another Owner (checked against the single `owner_user_id`).
- **Async & events:** Invite may send `TeamInviteMail` (email domain); audit rows as above.
- **External systems:** Mail transport (see MAIL/NOTIF).
- **Settings:** Plan limit `user_seat_limit`.
- **Acceptance criteria:**
  - Given a Manager, when calling invite, remove or reset-password, then 403.
  - Given an Admin, when removing the workspace's `owner_user_id` user, then 422.
  - Given an Admin, when inviting with role owner, then 403.
  - Given the seat cap reached, when inviting, then the plan-limit error and no user is created.
- **Source refs:** app/Http/Controllers/WorkspaceMembersController.php, app/Support/WorkspacePermissions.php, resources/js/charts/user-team-inbox-members.js
- **Port notes:** Apply the same rank rule as WD-RBAC-026 to remove and reset-password. Password reset of another member should be a reset-link, not a shown temp password, in the port unless parity is required by WSP.

### WD-RBAC-028 — Conversation visibility policy

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-RBAC-004
- **Summary:** `ConversationPolicy::view` decides whether a user may open a conversation and is the base check for replying and noting.
- **Actors & access:** Any authenticated user; resolution order stops at the first match.
- **UX & screens:** A denied open returns 403 JSON to the SPA which shows an error toast.
- **Endpoints:** `GET team-inbox/api/conversations/{id}` (`show`), `POST .../presence`, `POST .../presence/leave`, `POST .../save-contact`, `POST team-inbox/api/messages/{id}/extract-contact`, and the message-level actions that resolve the message through the helper that authorizes view: `DELETE|PATCH ... /messages/{mId}` (delete, edit, forward, info, pin, react, star). All under middleware `Authenticate` only.
- **Data:** Reads `conversations.workspace_id`, `assignee_user_id`, `assignee_team_id`, team membership (`team_user`), pivot membership.
- **Rules & edge cases:**
  1. Step 1: holder of `platform.conversation.view_all` => allowed in any workspace.
  2. Step 2: must be a member of the conversation's workspace, else denied. (Membership is the tenant boundary; the lookup helper also scopes to the caller's current workspace and 404s across workspaces.)
  3. Step 3: holder of `inbox.view_all_teams` (Owner, Admin, Manager, Agent) => allowed.
  4. Step 4: the user is the direct assignee => allowed, regardless of any permission.
  5. Step 5: the conversation is assigned to a team the user belongs to => result is exactly whether the role has `inbox.view_team` (Viewer yes).
  6. Step 6: otherwise `inbox.view_assigned` AND assignee = user, which is unreachable in effect (step 4 covers it). So a Viewer sees only conversations assigned to them or to their team; unassigned or others' conversations => denied.
  7. QUIRK: message edit/delete/forward/pin/react/star/info are authorized with `view` only, not `reply`, so a Viewer who has been assigned (or is on the team of) a conversation can edit or delete messages in it. `create-deal`, `deals` list for a conversation and `retry-media` perform no policy check at all beyond workspace scoping.
  8. Conversations older than the multi-tenant migration may have a null workspace; they fall back through a scope to the original opener (comment in the lookup helper).
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a Viewer and an unassigned conversation, when GET show, then 403.
  - Given a Viewer and a conversation assigned to a team the Viewer belongs to, when GET show, then 200.
  - Given an Agent, when GET show on any workspace conversation, then 200.
  - Given a Platform Support user with console access, when reading another workspace's conversation via the platform inbox, then 200.
  - Given a user from another workspace, when GET show, then 404.
- **Source refs:** app/Policies/ConversationPolicy.php, app/Http/Controllers/TeamInboxController.php (findConvInCurrentWorkspace, findConvMessage, show, presence*), app/Providers/AppServiceProvider.php
- **Port notes:** Express as `inbox.conversation.read` with `record_scope` all/team/own (see WD-RBAC-004 port notes) evaluated in the service predicate rather than per-row policy. Add explicit permissions for message edit/delete and for creating deals from a conversation.

### WD-RBAC-029 — Conversation action gates

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-RBAC-028
- **Summary:** Each conversation action maps to one workspace permission, evaluated by `ConversationPolicy`. Reply and note additionally require that the user can view the conversation.
- **Actors & access:** Workspace members holding the key (matrix in WD-RBAC-004); membership of the conversation's workspace is required first.
- **UX & screens:** Composer, resolve, snooze, tag, priority, assign buttons show only when the bootstrap permission map says true; otherwise the server returns 403.
- **Endpoints:** (all `Authenticate` middleware only; prefix `team-inbox/api/`)

| Ability / permission                  | Endpoints                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| reply => inbox.reply AND view         | POST conversations/{id}/reply, /media, /catalog, /voice, /ai-suggest, /run-ig-flow |
| note => inbox.note AND view           | POST conversations/{id}/notes; DELETE conversations/{id}/notes/{noteId}            |
| resolve => inbox.resolve              | POST conversations/{id}/resolve, /reopen                                           |
| snooze => inbox.snooze                | POST conversations/{id}/snooze                                                     |
| tag => inbox.tag                      | POST conversations/{id}/tag; DELETE conversations/{id}/tag/{tagId}                 |
| priority => inbox.priority            | POST conversations/{id}/priority                                                   |
| bulk => inbox.bulk (per conversation) | POST bulk                                                                          |
| assign => see WD-RBAC-030             | POST conversations/{id}/assign, /unassign, /assign-assistant, /assign-agent        |

- **Data:** Reads permissions per WD-RBAC-004; writes as owned by TIB1/TIB2.
- **Rules & edge cases:**
  1. Resolve, snooze, tag, priority, assign and bulk do NOT require `view`: with the permission a user can act on a conversation they could not open (only relevant to Agent-and-above roles which all have view_all_teams, so no practical exposure today).
  2. Bulk: the endpoint authorizes `bulk` once per selected conversation and silently skips those that fail; it does not check the per-action permission, so Owner/Admin/Manager (the only holders) can bulk resolve, reopen, snooze, set priority, tag and assign. Bulk assign targets are validated to belong to the workspace.
  3. Deleting an internal note: requires `inbox.note`, then only the author may delete unless the user holds `inbox.view_all_teams`. QUIRK: because Agent holds view_all_teams, agents can delete other people's notes.
  4. Message-level edits fall under WD-RBAC-028 rule 7.
  5. Unauthorized ability => HTTP 403 (Laravel authorization exception) with no message customization.
  6. Not gated by any permission: `POST team-inbox/api/compose` (start new outbound conversations to many contacts, groups or raw numbers) has no permission check at all, so a Viewer can send messages through it (wallet and plan gates still apply in the dispatcher). Also un-gated: saved-reply use counter, AI agent test-reply, retry-media, me/status, notification read-all.
- **Async & events:** Actions write conversation events and audit rows (TIB1/TIB2).
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a Viewer, when posting a reply, then 403.
  - Given an Agent, when calling resolve, snooze, tag: 200; priority: 403; bulk: 403.
  - Given a Manager, when calling bulk with 3 ids where the user is a workspace member, then all 3 are processed.
  - Given an Agent, when deleting a note authored by someone else, then it is deleted (parity quirk).
  - Given a Viewer, when posting to compose, then it is accepted (parity gap; port should require `inbox.conversation.reply`).
- **Source refs:** app/Policies/ConversationPolicy.php, app/Http/Controllers/TeamInboxController.php, routes/web.php
- **Port notes:** One decorator per endpoint. Add the missing gate on compose. Decide whether Agent may delete others' notes; recommend author-or-manager.

### WD-RBAC-030 — Assignment authority: assign versus claim-only

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-RBAC-029
- **Summary:** Two levels of assignment authority: `inbox.assign` may hand a conversation to anyone or any team with any strategy; `inbox.assign_self` (Agent) may only claim a conversation for themselves.
- **Actors & access:** Owner, Admin, Manager hold both; Agent holds claim-only; Viewer none.
- **UX & screens:** Assign button/menu and "reassign" link are shown when the user can assign at all (`inbox.assign` or `inbox.assign_self`); the bulk assign button is tied to `inbox.bulk` and claims the selection for the current user.
- **Endpoints:**

| Method uri                                              | Route name                           | Controller@action          | Authorization                                                                                                                                                                                                                                  |
| ------------------------------------------------------- | ------------------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST team-inbox/api/conversations/{id}/assign           | user.team-inbox.api.assign           | TeamInboxController@assign | body user_id (nullable, must be a member of the workspace), team_id (nullable, must exist in the workspace and not be deleted), strategy (nullable, manual / round_robin / least_loaded / sticky). Authorized AFTER validation with the target |
| POST team-inbox/api/conversations/{id}/unassign         | user.team-inbox.api.unassign         | @unassign                  | authorize assign with no target => requires inbox.assign                                                                                                                                                                                       |
| POST team-inbox/api/conversations/{id}/assign-assistant | user.team-inbox.api.assign-assistant | @assignAssistant           | requires inbox.assign                                                                                                                                                                                                                          |
| POST team-inbox/api/conversations/{id}/assign-agent     | user.team-inbox.api.assign-agent     | @assignAgent               | attach an AI agent (agent_id nullable integer, must belong to the workspace); requires inbox.assign                                                                                                                                            |

- **Data:** Writes conversation assignee columns, events, notifications (TIB2 owns).
- **Rules & edge cases:**
  1. `assign` policy: must be workspace member; if `inbox.assign` => allowed; else needs `inbox.assign_self`; then allowed only when strategy is `manual`, target user is set and equals the caller, and the target team is either null or equals the conversation's current team.
  2. Default strategy when only a team is given: the team's configured `assignment_strategy`; otherwise `manual`. So an Agent cannot pick a team without a user (strategy would not be manual-with-self).
  3. Unassign and reassign-away require `inbox.assign`, so an Agent cannot release a conversation they claimed (a comment states this is intended: it stays with the manager).
  4. Attaching an AI agent makes it auto-reply to the customer, hence the same permission as human assignment (added later to fix a gap).
- **Async & events:** Assignment notifications and events (NOTIF/TIB2).
- **External systems:** None.
- **Settings:** Team assignment strategy (TIB2).
- **Acceptance criteria:**
  - Given an Agent, when assigning to themselves with strategy manual, then 200.
  - Given an Agent, when assigning to a teammate, or with strategy round_robin, or unassigning, then 403.
  - Given a Manager, when assigning to any member, then 200.
  - Given a target user who is not in the workspace, when assigning, then 422 "not part of this workspace".
- **Source refs:** app/Policies/ConversationPolicy.php (assign), app/Http/Controllers/TeamInboxController.php (assign, unassign, assignAssistant, assignAgent), resources/js/charts/user-team-inbox-index.js
- **Port notes:** Two permission keys (`inbox.conversation.assign`, `inbox.conversation.assign_self`) plus the same target-aware check in the service. Keep validation of the target org.

### WD-RBAC-031 — Inbox list scoping by view_all_teams

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-RBAC-028
- **Summary:** Only the "All" tab of the inbox list, and its counter badge, honour `inbox.view_all_teams`; every other tab lists workspace-wide subsets to any member.
- **Actors & access:** Any workspace member.
- **UX & screens:** Inbox tabs Mine, Unassigned, Unread, Mentions, SLA breach, All with badges (`counts`).
- **Endpoints:**

| Method uri               | Route name                | Controller@action         | Middleware   | Behavior                                                                   |
| ------------------------ | ------------------------- | ------------------------- | ------------ | -------------------------------------------------------------------------- |
| GET team-inbox/api/queue | user.team-inbox.api.queue | TeamInboxController@queue | Authenticate | tab filter as below; response items, has_more, counts, archived_count, sig |

- **Data:** Reads `conversations`, `conversation_participants`, `team_user`.
- **Rules & edge cases:**
  1. Tab `all`: users with `inbox.view_all_teams` see the whole workspace list; others see conversations assigned to themselves or to any of their teams. `queueCounts` mirrors it so badges match.
  2. Tabs `unassigned`, `unread`, `sla_breach` are workspace-wide for everyone; `mine` and `mentions` are personal.
  3. QUIRK / gap: a Viewer therefore sees titles and previews of all unassigned/unread/SLA-breached conversations in the list although opening them is denied by the policy (WD-RBAC-028). Because every role except Viewer carries `inbox.view_all_teams`, the scoped branch effectively only applies to Viewers.
  4. Unknown tab values fall back to `mine`.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a Viewer with one assigned conversation, when opening tab All, then only that conversation (plus team conversations) is listed and the badge matches.
  - Given the same Viewer, when opening Unassigned, then the workspace's unassigned conversations are listed (parity; port should restrict).
  - Given a Manager, when opening All, then all workspace conversations.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (queue, queueCounts)
- **Port notes:** Apply the read scope (`all`/`team`/`own`) in the query for every tab, including counts.

### WD-RBAC-032 — Workspace-setting permission gates in the team-inbox API

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-RBAC-004
- **Summary:** Configuration endpoints of the team inbox check a named workspace permission and 403 otherwise; TeamPolicy covers team update/delete.
- **Actors & access:** As per matrix. All routes `Authenticate` only (no role middleware), so the controller check is the only guard.
- **UX & screens:** Team-inbox settings drawer cards (Members if `member.invite`, Integrations if `integration.manage`, Routing if `routing.manage`, Saved replies if `savedreply.manage`, SLA if `sla.manage`, Analytics if `analytics.view`, and a Webhooks card behind the non-existent `webhook.manage`).
- **Endpoints:** (prefix `team-inbox/`)

| Permission         | Endpoints                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| team.manage        | POST api/teams (create, permission check); PATCH api/teams/{id} and DELETE api/teams/{id} (via TeamPolicy update/delete, which also require workspace membership)                    |
| tag.manage         | POST api/tags; DELETE api/tags/{id}                                                                                                                                                  |
| savedreply.manage  | POST api/saved-replies; PATCH api/saved-replies/{id}; DELETE api/saved-replies/{id}                                                                                                  |
| routing.manage     | POST api/routing; PATCH api/routing/{id}; DELETE api/routing/{id}; POST api/business-hours                                                                                           |
| sla.manage         | POST api/sla; PATCH api/sla/{id}; POST sla; PUT sla/{id}; DELETE sla/{id} (the last three also behind route middleware manager)                                                      |
| integration.manage | GET/POST api/webhooks; PATCH/DELETE api/webhooks/{id}; POST api/ai-agents; PATCH/DELETE api/ai-agents/{id}; POST api/ai-keys; PATCH api/ai-keys/{id}/toggle; DELETE api/ai-keys/{id} |

- **Data:** Writes teams, tags, saved replies, routing rules, business hours, SLA policies, webhooks, AI agents, AI provider keys (TIB1/TIB2/AIAG own the data).
- **Rules & edge cases:**
  1. Read endpoints are not gated: teams, tags, saved replies, routing, business hours, SLA policies, AI agents, AI key list (id, provider, active flag only) can be listed by any member, and the AI-agent test-reply is ungated.
  2. `team.manage` create checks the permission directly; update/delete use the policy, which additionally requires membership of the team's workspace.
  3. `TeamPolicy::viewAny/view/create` exist; only update and delete are invoked.
  4. Manager gets `tag.manage` and `savedreply.manage` but not routing/SLA/team/integration; the SLA page is reachable by Manager (route gate) yet every write is a 403.
  5. Owner-only business-hours timezone: the business-hours update only changes the workspace timezone when the caller is `owner_user_id` (WD-RBAC-034).
- **Async & events:** None here.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a Manager, when creating a team, then 403; creating a tag: 200.
  - Given an Admin, when creating an SLA policy, then 200.
  - Given an Agent, when listing teams, then 200 (read is ungated).
  - Given a Manager on the SLA page, when saving, then 403.
- **Source refs:** app/Http/Controllers/TeamInboxController.php, app/Policies/TeamPolicy.php, resources/views/user/team-inbox/index.blade.php
- **Port notes:** One key per resource (`inbox.team.manage`, ...) and read keys at least `inbox.settings.read`; do not leave the lists open. Manager reaching a page whose every action is forbidden is a UX bug; hide it.

### WD-RBAC-033 — Permission map exposed to the client and blade

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-RBAC-004
- **Summary:** The server tells the front end which of the 23 workspace permissions the current user holds so the UI hides actions the server would reject; blade templates use a custom directive for the same purpose.
- **Actors & access:** Any workspace member for their own map.
- **UX & screens:** The team-inbox SPA and the members page read `permissions` from bootstrap; `can(key)` is strictly true only when the value is boolean true, so a missing key means hidden. Assignment controls, bulk-assign button, team management and members actions are toggled by it. Blade `@canWorkspace('key')` (optional workspace id) wraps settings cards and the invite/role UI.
- **Endpoints:**

| Method uri                   | Route name   | Controller@action             | Middleware   | Response                                                                                                                                                                                                  |
| ---------------------------- | ------------ | ----------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET team-inbox/api/bootstrap | (TIB1 owner) | TeamInboxController@bootstrap | Authenticate | `permissions` (map of all 23 keys => bool for the current workspace), `me` (id, name, email, `role` string for the current workspace, status, load, unread notifications), teams, members, statuses, tags |

- **Data:** Computed per request from the role (WD-RBAC-004); nothing stored.
- **Rules & edge cases:**
  1. The map is computed with the caller's current workspace; an impersonating admin gets the Owner map.
  2. The mobile API returns only the role string per workspace (`role`), not a permission map; the apps must derive capabilities themselves.
  3. The platform equivalent returns the 16 `platform.*` keys (WD-RBAC-003).
  4. The UI hiding is advisory; enforcement is server-side, and there are gaps between them (WD-RBAC-025, WD-RBAC-029).
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given an Agent, when the bootstrap response is read, then `inbox.assign` is false, `inbox.assign_self` is true and the assign button is shown in claim-only mode.
  - Given a Viewer, when the SPA loads, then reply, note, resolve, snooze, tag controls are hidden.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (bootstrap), app/Providers/AppServiceProvider.php (canWorkspace directive), resources/js/charts/user-team-inbox-index.js, resources/js/charts/user-team-inbox-members.js
- **Port notes:** Expose `GET /me/permissions` returning the resolved grant set (keys and scopes) from `RbacService.grantsForUser`; reuse it in the web app's permission provider and the mobile clients.

### WD-RBAC-034 — Owner-only and owner/admin-only checks outside the permission map

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-RBAC-024
- **Summary:** A second family of role tests is hard-coded in controllers: some ask "is this user `workspaces.owner_user_id`", others "owner or admin by pivot role". They sit beside the permission map and do not share its vocabulary.
- **Actors & access:** As listed per row.
- **UX & screens:** Settings tabs for non-owners are disabled or return 403; see per row.
- **Endpoints:**

| Check                                                                                                  | Where                                                                                                                                                                                                                               | Effect                                                                                                                    |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `owner_user_id` must equal user (403 "Owner only.", 404 when no workspace)                             | `SettingsTabsController::ownerWorkspaceOrFail` for POST settings/branding, POST settings/notifications, POST/DELETE settings/aikeys/{provider}, GET settings/export/{type}, DELETE settings/workspace, POST settings/data-residency | workspace branding, notification preferences, workspace AI provider keys, data export, workspace deletion, data residency |
| `owner_user_id` equals user, else silent no-op with message "Only the workspace owner can edit these." | `UserPagesController::settingsUpdate`                                                                                                                                                                                               | workspace name, timezone, currency                                                                                        |
| `owner_user_id` equals user                                                                            | `AccountController` profile save; `TeamInboxController::businessHoursUpdate`                                                                                                                                                        | workspace timezone written only for the owner; others' value ignored silently                                             |
| pivot role owner or admin (or `owner_user_id`)                                                         | `TeamChatController::isAdmin`: create channel, delete channel (general is protected), delete or pin others' messages, list all invitations and approve/decline invitations                                                          | non-admins see only their own invitations                                                                                 |
| `owner_user_id` OR pivot owner/admin                                                                   | `Api\App\WorkspaceController::update` (mobile): 403 "Only the workspace owner or an admin can edit it."                                                                                                                             | rename, timezone, industry, size range                                                                                    |
| pivot owner/admin or legacy admin column                                                               | `AiCrmController` (`canToggleWa`)                                                                                                                                                                                                   | show the WhatsApp copilot toggle                                                                                          |
| order owner, or workspace-level rule, or `isAdmin()`                                                   | `CheckoutController` submit                                                                                                                                                                                                         | 403 otherwise                                                                                                             |
| pivot owner/admin or legacy admin column, plus plan gate                                               | workspace switcher "Create new workspace" link                                                                                                                                                                                      | mirrors route gate `workspace.role:admin` on `workspaces/create` and `POST workspaces`                                    |

- **Data:** `workspaces.owner_user_id`, `workspace_user.role`.
- **Rules & edge cases:**
  1. QUIRK: two definitions of "owner". A second pivot Owner, or an Admin, is blocked from every owner-only setting above; only the single `owner_user_id` user passes. There is no ownership-transfer UI in workspace settings (the admin console can change the owner column).
  2. `TeamChatController::isAdmin` is the only place that grants Admin the same power as Owner via a helper; every other place hard-codes.
  3. Members and agents see the reduced state without an error in several cases (silent no-op), which hides denials from audit.
- **Async & events:** Security audit rows for some settings changes (`SecurityAuditLogger`, e.g. data residency).
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a workspace Admin who is not `owner_user_id`, when posting settings/branding, then 403 "Owner only.".
  - Given the same Admin, when saving name/timezone/currency, then nothing changes and the message says only the owner can edit.
  - Given a Manager in Team Chat, when creating a channel, then 403 "Only workspace admins can create channels".
- **Source refs:** app/Http/Controllers/SettingsTabsController.php, app/Http/Controllers/UserPagesController.php (settingsUpdate), app/Http/Controllers/AccountController.php, app/Http/Controllers/TeamChatController.php, app/Http/Controllers/Api/App/WorkspaceController.php, app/Http/Controllers/AiCrmController.php, app/Http/Controllers/CheckoutController.php, resources/views/components/user/header.blade.php
- **Port notes:** Replace with two explicit permissions (`org.settings.manage` for Owner+Admin or Owner-only per setting, `org.delete` for Owner only) and use the Owner preset plus a "primary owner" flag only where truly needed (deleting the org, transferring ownership). Each owning domain (SET, TCHAT, MOB, AICRM, CHK) should cite this table.

### WD-RBAC-035 — Role-tier navigation and role-based landing

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-RBAC-024
- **Summary:** Menu items are filtered by a three-tier rank derived from the workspace role, and post-login landing differs for Agents and Viewers.
- **Actors & access:** Derived per request from `workspaceRole()`.
- **UX & screens:** Rank mapping: owner or admin => 3; manager => 2; agent or viewer => 1; no role or unknown role (including legacy `member`) => 3 (full nav, "platform-only users keep legacy view"). An item shows when rank >= its tier. Top bar (`components/user/header.blade.php`) tiers: manager = dashboard, templates, contacts, chat, analytics, message-history, wa-links, support; everything else admin, including `more`. Sidebar catalogue (`Support/UserNav`): manager = dashboard, analytics, notifications, chat, team-chat, contacts, attributes, contact-groups, lead-finder, templates, message-history, ai-usage, wa-links, support, guidebook; 41 further items are admin. Plan-feature items are shown but marked locked rather than hidden. An admin-configurable top-bar order (`user_nav_order`) applies after the tier filter.
- **Endpoints:** Landing rules: `POST /login` (`AuthPagesController@login`) sends Agent/Viewer to `/team-inbox`, others to the dashboard, via `intended()` (a stored intended URL wins, then the role gate bounces); social sign-in does the same; `GET /home` sends platform admins to `/admin`, Agent/Viewer to `/team-inbox`, everyone else to `/dashboard`. `GET /dashboard` is manager-gated.
- **Data:** None.
- **Rules & edge cases:**
  1. QUIRK: the team-inbox item is tier admin in both menus, and no item is tier agent, so for an Agent or Viewer the top bar and sidebar list nothing; the team inbox page renders with its own chrome (header hidden by the layout) and is their only surface.
  2. Nav tiers do not equal route gates: `/scheduled` is admin in nav but manager on the route; `/wa-links` is manager in nav but admin on the route; many admin-tier pages have no route gate (WD-RBAC-025 rule 1).
  3. The create-workspace link is shown only to pivot owner/admin (or legacy admin), when not on a tenant custom domain and the plan allows more workspaces.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** `user_dashboard_layout` (topbar or sidebar), `user_nav_order` (admin-set menu order).
- **Acceptance criteria:**
  - Given a Manager, when the header renders, then Dashboard, Templates, Contacts, Chat, Analytics, History, WA Links, Support appear and Devices, Flows, Broadcasts do not.
  - Given an Agent logging in without a stored intended URL, then the landing is /team-inbox.
  - Given an Owner, when viewing /home, then redirect to /dashboard.
- **Source refs:** resources/views/components/user/header.blade.php, app/Support/UserNav.php, app/Http/Controllers/AuthPagesController.php, app/Http/Controllers/SocialAuthController.php, routes/web.php (/home)
- **Port notes:** Drive the nav from the user's permission set, not a role-tier rank (each item declares the permission it requires). Landing route comes from the highest-priority permission (inbox-only users => inbox).

### WD-RBAC-036 — Surfaces with no role enforcement (mobile API, REST API, Node)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-RBAC-025
- **Summary:** Non-browser entry points authenticate as a user but never apply the workspace role gate or permission map, so a Viewer's mobile token or REST API key has the same reach as an Owner's, apart from a few explicit exceptions.
- **Actors & access:** Mobile app (Sanctum bearer token + `ResolveAppWorkspace`), REST API v1 clients (workspace API key), Node bridge (shared token), Chrome extension.
- **UX & screens:** None.
- **Endpoints:** (behavioral, not new routes)

| Surface                               | Auth                                                                                                                                                                                    | Role handling                                                                                                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/app/*`                          | bearer token; optional `X-Workspace-Id` must be a workspace where the user has a pivot row with `joined_at` set (403 "You are not a member of that workspace."), applied in memory only | no `EnsureWorkspaceRole`, no permission map. Exceptions: `Api\App\WorkspaceController::update` (owner or admin, WD-RBAC-034) and `/api/app/admin/payment-gateways*` (users.role admin or Spatie Admin) |
| `/api/v1/*`                           | `Authorization: Bearer wsk_...` or `X-Api-Key` (hash lookup, revoked/expired rejected) then acts as the key's `user_id` with the key's workspace current                                | no role checks; the `scopes` array on the key is stored and has a `hasScope` helper, but nothing in the codebase calls it; one active key per workspace                                                |
| Node bridge routes (`routes/api.php`) | `X-Node-Token` shared secret                                                                                                                                                            | no user; separate from RBAC                                                                                                                                                                            |

- **Data:** `api_keys` (workspace_id, user_id, scopes json, revoked_at, expires_at), `workspace_user`.
- **Rules & edge cases:**
  1. Combined with WD-RBAC-025 rule 1 (REST-key page ungated), any workspace member can mint the single workspace API key and thereby gain unrestricted API power as themselves.
  2. The mobile app therefore relies purely on the client to hide features; server denies nothing by role.
  3. Impersonation, the Spatie admin bypass and role gates do not apply to these surfaces.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a Viewer's mobile token, when creating a campaign, then it is accepted (parity gap).
  - Given a revoked API key, when calling v1, then 401 `invalid_api_key`.
  - Given a header workspace where the user is not a joined member, when calling the mobile API, then 403.
- **Source refs:** app/Http/Middleware/ResolveAppWorkspace.php, app/Http/Middleware/AuthenticateApiKey.php, app/Models/ApiKey.php, app/Http/Controllers/Api/App/WorkspaceController.php, app/Http/Controllers/Api/App/PaymentGatewayController.php, app/Http/Controllers/DeveloperApiController.php, bootstrap/app.php
- **Port notes:** In the target the API and mobile surfaces share the same guard/permission decorators as the web app (actor kind `staff`); API keys carry explicit permission scopes that are enforced. Do not port the "acts as the key creator with full reach" behaviour.

### WD-RBAC-037 — Unenforced workspace permissions and unused policy methods

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-RBAC-004
- **Summary:** Several defined permissions and policy methods are never used, or are used with a key that does not exist. They document intent but change nothing.
- **Actors & access:** None.
- **UX & screens:** A hidden Webhooks card in the team-inbox settings drawer.
- **Endpoints:** None.
- **Data:** N/A.
- **Rules & edge cases:**
  1. `workspace.billing` (Owner only): not referenced anywhere. Billing and plan pages are gated only by route (e.g. `account/subscription/cancel` is manager+) and by owner checks elsewhere, so the "Owner has billing, Admin does not" statement in the docs is not enforced by this key.
  2. `workspace.settings` (Owner, Admin): only referenced by `WorkspacePolicy::update`, which nothing calls. `WorkspacePolicy::manageMembers`, `impersonate`, `suspend`, `flag`, `view` are likewise never invoked (no `authorize` on a workspace).
  3. `analytics.view`: only toggles a link in the team-inbox settings drawer; the analytics routes are protected by role (manager) and plan feature, not by this key.
  4. `webhook.manage`: referenced by blade, not defined in any role; the Webhooks card is therefore hidden for everyone (dead UI).
  5. `TeamPolicy::viewAny`, `view`, `create` are unused (only `update`/`delete` are invoked); `PlatformPermissions::MATRIX` and `permissionsFor` are unused; `EnsurePlatformRole` is unused (WD-RBAC-015).
  6. `inbox.view_assigned` is redundant in the policy (WD-RBAC-028 rule 6).
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given the port, when reviewing enforcement coverage, then every retained permission key has at least one enforced endpoint or UI gate (test).
  - Given the Owner-only billing rule in the docs, when an Admin calls a billing-management endpoint in the port, then 403 (new behaviour).
- **Source refs:** app/Support/WorkspacePermissions.php, app/Policies/WorkspacePolicy.php, app/Policies/TeamPolicy.php, resources/views/user/team-inbox/index.blade.php
- **Port notes:** Enforce `workspace.billing` on wallet top-up, plan change and invoices (BILL/PLAN domains) so Admin cannot spend. Drop the rest.

## Data model

Tables owned by this domain (all Spatie `laravel-permission`, guard `web`; MySQL in WaDesk, target uses Postgres):

### `roles`

Purpose: platform role definitions (global, not per workspace). Columns: `id` bigint unsigned PK; `name` varchar(255) NOT NULL; `guard_name` varchar(255) NOT NULL; `created_at`, `updated_at` nullable timestamps (the edit screen shows `updated_at` as "Last edited"; the seeder sets timestamps at first creation only). Unique (`name`, `guard_name`). No soft delete. Volume: 6 seeded plus custom; tiny. Read by WD-RBAC-005..010, 001. Written by create/update/delete/duplicate. Controller uniqueness rule is on name alone (case-insensitive under the MySQL collation).

### `permissions`

Purpose: catalogue of permission keys. Same columns and unique key as `roles`. 101 rows seeded (85 admin-console keys + 16 platform keys); ids 1..101 in seed order. Read by role editors, permission catalogue; written by create/delete permission. Names are unconstrained strings (max 191 validated).

### `role_has_permissions`

Purpose: role to permission grants. PK (`permission_id`, `role_id`); FK to `permissions` and `roles`, both ON DELETE CASCADE; index on `role_id`. Seeded counts: Super Admin 101, Admin 101, Manager 42, User 22, Platform Support 9, Auditor 4. Written by full-sync on role save, duplicate; read by role screens and by every `hasPermissionTo`.

### `model_has_roles`

Purpose: which users hold which roles. PK (`role_id`, `model_id`, `model_type`); index (`model_id`, `model_type`); FK role cascade. `model_type` is the User class name. Seed: user 1 has Super Admin. Written by installer (`syncRoles`), mobile registration (`assignRole('User')`), role reassign; the platform screens never write it otherwise (WD-RBAC-021).

### `model_has_permissions`

Purpose: direct user-permission grants. Same shape as above with `permission_id`. Never written by the application (dead table); `hasPermissionTo` would read it if rows existed.

Shared tables and columns this domain depends on but does not own (see WSP, AUTH):

- `workspace_user` (WSP): `role` varchar(32) default `member` is the workspace role; unique (workspace_id, user_id); `invited_at`, `joined_at` nullable.
- `workspaces.owner_user_id` (WSP): the single "primary owner" used by owner-only checks.
- `users.role` varchar(255) default `user` (AUTH): legacy platform-admin/suspension flag; `users.current_workspace_id` selects the workspace whose role applies.
- `impersonation_sessions`, `audit_logs` (ASHELL/NOTIF): used by WD-RBAC-020 and 023.

## Cross-domain contracts

- **Consumes from INST:** seeder run and first Super Admin creation (WD-RBAC-001). INST must call the roles/permissions seed before creating the admin.
- **Consumes from WSP:** `workspace_user` rows and their `role`, `workspaces.owner_user_id`, workspace suspension handling, members page and invite/remove/reset flows (WD-RBAC-024, 026, 027). RBAC defines the grant rules; WSP owns the flows and screens and must call `canGrantRole` equivalents.
- **Consumes from AUTH:** login landing decisions (WD-RBAC-016, 035), `users.role` = suspended handling, 2FA policies targeting "admin-level roles", Force2FA, IP allowlist (part of the admin gate).
- **Consumes from NOTIF:** the `Audit`/`AuditLogger` writers (WD-RBAC-023); audit permission keys `audit.view`/`audit.export`/`platform.audit.view`.
- **Consumes from PLAN:** `EnforcePlanFeature`, `PlanLimitGuard` (admin bypass in WD-RBAC-017; `user_seat_limit` on invite).
- **Exposes to TIB1/TIB2:** `ConversationPolicy` abilities, the queue scoping rule, the bootstrap `permissions` map and the per-endpoint permission table (WD-RBAC-028..033). Each TIB feature must cite the ability it enforces.
- **Exposes to every gated domain (CAMP, BCAST, TPL, FLB, WADEV, CON, CHAT, AICRM, SCHED, WFL, SALES, INV, CAT, STORE, MADS, CALL, AR, AIAG, WGT, INTG...):** the route-level minimum role from WD-RBAC-025. Their entries reference it rather than restating it; the port replaces it with real permission keys per feature.
- **Exposes to ASHELL:** the admin gate (WD-RBAC-015), Super Admin-only rule (WD-RBAC-018), role/permission screens and admin sidebar counts; ASHELL owns the layout, `/admin/users` (which edits `users.role`) and the platform inbox routes listed in WD-RBAC-019.
- **Exposes to MOB and API:** nothing enforced (WD-RBAC-036); they must adopt the shared guard in the port.
- **Exposes to TCHAT, SET, CHK, AICRM:** the owner-only / owner-or-admin checks in WD-RBAC-034.
- **Exposes to CORE:** `Gate::policy` registrations, the `@canWorkspace` blade directive, permission cache configuration.

## Open questions & quirks

1. **Which "Admin" is platform staff?** `userHasPlatformAccess` excludes the Spatie Admin role and `users.role = admin` although comments and docs list Admin among staff; `isAdmin()` includes it. Confirm intended set before porting login landing and maintenance bypass (WD-RBAC-016).
2. **Platform Support and Auditor cannot reach `/admin`** (admin gate only accepts Super Admin / Admin / legacy admin). Either the intent was `EnsurePlatformRole` (unused) or these roles are unfinished. Docs advertise them as working (WD-RBAC-015, 003).
3. **No UI assigns a Spatie role to a user** (docs claim User Management does). Roles reach users only through installer, mobile register, or Reassign (WD-RBAC-021).
4. **85 of 101 permission keys are never enforced**; nine of the 16 `platform.*` keys are (WD-RBAC-002, 003, 037). Docs imply role edits control admin console access; they do not.
5. **Super Admin lock is only on delete** and only by role name; rename or strip is possible; no last-super-admin protection on reassign; trashing a Super Admin is unguarded (WD-RBAC-007, 009, 018).
6. **Seeder re-run overwrites seeded roles' grants** (WD-RBAC-001).
7. **Permission create validates uniqueness on the wrong value** and can 500 on a composed duplicate; label/description/scope/template fields are dead; filters and search on both catalogue screens are inert (WD-RBAC-005, 011, 012, 022).
8. **Role list "System" badge** covers only Super Admin and Admin; the other four seeded roles show Custom (WD-RBAC-005).
9. **Mobile-registered users get the `User` role**, which carries `platform.audit.view` and `platform.billing.view`; harmless today only because those checks sit behind the admin gate (WD-RBAC-001).
10. **Workspace role gaps (security-relevant):** Admin can demote or remove Owners/Admins and reset their passwords except the primary owner (WD-RBAC-026, 027); compose send has no permission check; viewers can list unassigned conversations and edit/delete messages of conversations assigned to them; agents can delete others' notes; role gates missing on many pages that the nav hides (WD-RBAC-025, 028, 029, 031); REST key creation open to every member (WD-RBAC-036). The port should fix rather than replicate; each fix needs a decision recorded by the owning domain.
11. **Legacy `member` role** is a permission alias for Agent but is rank 0 in the route gate and shows the full nav (WD-RBAC-024).
12. **Two ownership models** (`owner_user_id` column vs pivot `owner`) produce inconsistent owner-only checks (WD-RBAC-034).
13. **`AuthController::login` is not routed**; `POST /login` is `AuthPagesController@login`. The unrouted method contains the `next` deep-link behaviour that may be needed for the PWA (WD-RBAC-016). Confirm which is live before porting deep-link handling.
14. **Platform inbox routes** (`admin/team-inbox/*`) and `admin/impersonate/*` are listed in WD-RBAC-019/020 for their permission gates but are not claimed in this file's coverage; their owner (TIB2 or ASHELL) must claim them. Likewise the other WorkspaceMembersController routes (members page, list, invite, remove, reset-password) are left to WSP; only the role-change route `PATCH team-inbox/api/members/{userId}/role` is claimed here.
15. **`workspace.billing`, `workspace.settings`, `analytics.view` (workspace), `webhook.manage`** are unused or undefined (WD-RBAC-037). The docs statement "Admin has no billing" is enforced only indirectly.
16. `PlatformPermissions::MATRIX` differs from the seeder for Platform Support (no `unflag`); the seeder wins at runtime.
17. `TeamPolicy` and `WorkspacePolicy` methods are largely unused; possibly meant for future controllers.
18. The stale "Owner - 28 / Manager - 22 / Agent - 8 / Viewer - 5 permissions" template labels do not match the actual matrix (23/15/9/2, Admin 22).
19. Header/topbar for Agent and Viewer lists no items (their only surface is the team inbox page); confirm this is intentional and not a rendering bug hidden by the inbox layout.
20. Tested behaviors above are from static analysis of v1.7.0; live checks (especially the un-gated compose and API-key creation) should be confirmed with the wadesk-verify-parity skill before the port decides to break parity.

## Coverage

```json wadesk-coverage
{
  "routes": [
    "GET admin/roles",
    "POST admin/roles",
    "GET admin/roles/create",
    "GET admin/roles/{id}/edit",
    "PUT admin/roles/{id}",
    "DELETE admin/roles/{id}",
    "POST admin/roles/{id}/duplicate",
    "POST admin/roles/{id}/reassign",
    "GET admin/permissions",
    "POST admin/permissions",
    "GET admin/permissions/create",
    "DELETE admin/permissions/{id}",
    "PATCH team-inbox/api/members/{userId}/role"
  ],
  "controllers": [
    "app/Http/Controllers/RoleController.php",
    "app/Http/Controllers/PermissionController.php"
  ],
  "services": ["app/Support/PlatformPermissions.php", "app/Support/WorkspacePermissions.php"],
  "models": [],
  "tables": [
    "roles",
    "permissions",
    "model_has_roles",
    "model_has_permissions",
    "role_has_permissions"
  ],
  "views": [
    "resources/views/admin/roles/index.blade.php",
    "resources/views/admin/roles/create.blade.php",
    "resources/views/admin/roles/edit.blade.php",
    "resources/views/admin/permissions/index.blade.php",
    "resources/views/admin/permissions/create.blade.php"
  ],
  "commands": [],
  "permissions": [
    "analytics.create",
    "analytics.delete",
    "analytics.edit",
    "analytics.view",
    "audit.export",
    "audit.view",
    "billing.cards",
    "billing.invoices",
    "billing.refund",
    "billing.view",
    "campaigns.create",
    "campaigns.delete",
    "campaigns.edit",
    "campaigns.send",
    "campaigns.view",
    "contacts.create",
    "contacts.delete",
    "contacts.edit",
    "contacts.view",
    "devices.create",
    "devices.delete",
    "devices.disconnect",
    "devices.edit",
    "devices.pair",
    "devices.view",
    "flows.create",
    "flows.delete",
    "flows.edit",
    "flows.view",
    "inbox.assign",
    "inbox.export",
    "inbox.reply",
    "inbox.view",
    "integrations.create",
    "integrations.delete",
    "integrations.edit",
    "integrations.view",
    "metaads.approve",
    "metaads.create",
    "metaads.delete",
    "metaads.edit",
    "metaads.refund",
    "metaads.view",
    "packages.create",
    "packages.delete",
    "packages.edit",
    "packages.view",
    "permissions.create",
    "permissions.delete",
    "permissions.edit",
    "permissions.manage",
    "permissions.view",
    "platform.audit.view",
    "platform.billing.view",
    "platform.conversation.flag_spam",
    "platform.conversation.view_all",
    "platform.note.write",
    "platform.permission.manage",
    "platform.role.manage",
    "platform.system.settings",
    "platform.user.suspend",
    "platform.user.view_all",
    "platform.workspace.flag",
    "platform.workspace.impersonate",
    "platform.workspace.suspend",
    "platform.workspace.unflag",
    "platform.workspace.unsuspend",
    "platform.workspace.view_all",
    "roles.create",
    "roles.delete",
    "roles.edit",
    "roles.view",
    "security.edit",
    "security.view",
    "settings.create",
    "settings.delete",
    "settings.edit",
    "settings.view",
    "support.create",
    "support.delete",
    "support.edit",
    "support.view",
    "templates.create",
    "templates.delete",
    "templates.edit",
    "templates.view",
    "users.create",
    "users.delete",
    "users.edit",
    "users.import",
    "users.login_as",
    "users.view",
    "webhooks.create",
    "webhooks.delete",
    "webhooks.edit",
    "webhooks.view",
    "workspaces.create",
    "workspaces.delete",
    "workspaces.edit",
    "workspaces.suspend",
    "workspaces.view"
  ],
  "middleware": [
    "app/Http/Middleware/EnsureUserIsAdmin.php",
    "app/Http/Middleware/EnsurePlatformRole.php",
    "app/Http/Middleware/EnsureWorkspaceRole.php"
  ],
  "node_files": [],
  "js_assets": [
    "resources/js/charts/roles-index.js",
    "resources/js/charts/roles-create.js",
    "resources/js/charts/roles-edit.js",
    "resources/js/charts/permissions-create.js"
  ],
  "misc_files": [
    "app/Policies/ConversationPolicy.php",
    "app/Policies/TeamPolicy.php",
    "app/Policies/WorkspacePolicy.php"
  ],
  "config_files": ["config/permission.php"],
  "doc_pages": [
    "Documentation/pages/admin-panel/roles-permissions.html",
    "Documentation/pages/account/team-members.html"
  ],
  "feature_map": {
    "WD-RBAC-005": ["GET admin/roles"],
    "WD-RBAC-006": ["GET admin/roles/create", "POST admin/roles"],
    "WD-RBAC-007": ["GET admin/roles/{id}/edit", "PUT admin/roles/{id}"],
    "WD-RBAC-008": ["POST admin/roles/{id}/duplicate"],
    "WD-RBAC-009": ["POST admin/roles/{id}/reassign"],
    "WD-RBAC-010": ["DELETE admin/roles/{id}"],
    "WD-RBAC-011": ["GET admin/permissions"],
    "WD-RBAC-012": ["GET admin/permissions/create", "POST admin/permissions"],
    "WD-RBAC-013": ["DELETE admin/permissions/{id}"],
    "WD-RBAC-026": ["PATCH team-inbox/api/members/{userId}/role"]
  }
}
```
