---
domain: admin-console-shell
code: ASHELL
title: Admin console and user app shell (navigation, quick access, tour)
wadesk_version: '1.7.0'
sources_read: 62
---

# Admin console and user app shell (navigation, quick access, tour)

## Overview

This domain is the **chrome around every other feature**: the two page shells (the platform-admin
console at `/admin/*` and the customer app at `/dashboard`, `/team-inbox`, ...), the navigation
inside them, and the small cross-cutting helpers that live in that chrome (workspace switcher,
notification bell, global search, quick-access shortcuts, guided tour, theme switcher, banners,
paywall sheet, toasts). It also owns the customer "Settings" hub at `/settings` (workspace name,
timezone, currency, branding, notification matrix, BYOK AI keys, 2FA, sessions, export, delete
workspace) because those routes live in one catch-all controller (`SettingsTabsController`) that
the task hints assigned here.

Actors:

- **Platform super-admin / admin** (Spatie role `Super Admin` or `Admin`, or legacy `users.role`
  in `admin|A`): sees the admin console shell (`components/layouts/admin`) with a left sidebar,
  a header slot, a live "platform health" pill and a platform notification bell. Every `/admin/*`
  route is behind three middleware: `auth`, `admin` (EnsureUserIsAdmin) and `ip.allowlist`.
- **Workspace owner / admin / manager / agent / viewer**: sees the customer shell
  (`components/layouts/user`). The shell has two admin-selectable modes: **topbar** (default; a
  64px header with a horizontal menu, a "More" gateway page and overflow) and **sidebar** (a left
  rail with every page grouped, plus a slim top strip). One global system setting
  (`user_dashboard_layout`) picks the mode for all customers.
- **End customers of a workspace never see this shell** (they use the storefront, chat widget,
  etc. owned by other domains).

Main flow end to end: user logs in (AUTH) -> `GET /home` router picks a landing page by role
(platform admin -> `/admin`, agent/viewer -> `/team-inbox`, everybody else -> `/dashboard`) ->
the layout resolves theme, brand, locale direction, plan/role gates, then renders nav + slot +
banners + floating widgets. Visibility of every menu item is decided by three independent gates:
(1) the **workspace-role tier** (agent < manager < admin/owner; platform admins with no
workspace role are treated as tier `admin`), (2) the **plan feature key** of the current
workspace (locked rows / crown badges / paywall sheet, never removal), and (3) **channel or
add-on availability** system settings (facebook_enabled, tiktok_enabled, telegram_enabled,
sms_enabled, line_enabled, wechat_enabled, viber_enabled, email_enabled, instagram add-on or
connected Instaflow, a connected WABA provider row). Nothing in the shell reads the Spatie
`*.view / *.create` permission keys; the shell only knows roles, plan features and settings.

How plan tiers change it: features are never hidden by plan in the shell. In sidebar mode a
plan-locked item stays visible, is dimmed with a lock icon and points at `/account/plans`; in the
topbar a gold crown badge sits on the item; on `/more` a non-clickable crown sits on the card;
opening a gated page renders it and slides a paywall sheet over it. Platform admins bypass all
plan checks. During a free trial or the last 7 days of a paid plan a full-width bar is shown
under the announcement strip.

Connections to other domains: AUTH (login redirect, logout form, 2FA enforcement), WSP
(workspace switching, membership guard, impersonation banner, workspace slug landing), RBAC
(workspace role hierarchy, platform roles), PLAN (feature keys, trial and renewal state,
`config/plan_gates.php`), NOTIF (bell feeds and preferences), DASH (dashboard/analytics pages
that the nav points to), SET (admin settings pages, PWA/SEO/analytics head partials, branding),
I18N (locale switcher, RTL `dir`), CMS (announcement content, frontend layout), ADD
(`ExtensionRegistry::nav('admin')` menu items), TIB1 (inbox bell endpoint, `/team-inbox`),
WADEV (connect-device flow inside the popover), AIADM (BYOK key model and shared keys).

## Feature index

| Id            | Feature                                                                  | Status      | Priority | Effort | Depends on                   |
| ------------- | ------------------------------------------------------------------------ | ----------- | -------- | ------ | ---------------------------- |
| WD-ASHELL-001 | Post-login home router (`/home`)                                         | implemented | P0       | S      | AUTH login, WD-ASHELL-002    |
| WD-ASHELL-002 | Admin console access gates (admin role, IP allowlist)                    | implemented | P0       | S      | RBAC, SET                    |
| WD-ASHELL-003 | Admin layout shell and page-chrome contract                              | implemented | P0       | M      | WD-ASHELL-002                |
| WD-ASHELL-004 | Admin sidebar navigation with live counts                                | implemented | P0       | M      | WD-ASHELL-003, ADD           |
| WD-ASHELL-005 | Admin sidebar collapse, group toggles, mobile drawer                     | implemented | P1       | S      | WD-ASHELL-004                |
| WD-ASHELL-006 | Admin header controls (health pill, theme, language, bell, user menu)    | implemented | P1       | M      | WD-ASHELL-003, NOTIF         |
| WD-ASHELL-007 | Admin flash toast and inline flash banner                                | implemented | P1       | S      | WD-ASHELL-003                |
| WD-ASHELL-008 | Admin settings hub (tile index and KPI strip)                            | implemented | P1       | M      | WD-ASHELL-003, SET           |
| WD-ASHELL-009 | Menu layout editor (user top bar vs More)                                | implemented | P1       | M      | WD-ASHELL-013                |
| WD-ASHELL-010 | Appearance: dashboard colour tokens and interface metrics                | implemented | P1       | M      | WD-ASHELL-024                |
| WD-ASHELL-011 | User shell mode (topbar or sidebar) and rail colours                     | implemented | P1       | M      | WD-ASHELL-010, WD-ASHELL-012 |
| WD-ASHELL-012 | User layout shell (head, boot globals, slots, hideHeader)                | implemented | P0       | L      | WD-ASHELL-011                |
| WD-ASHELL-013 | Top navigation bar (topbar mode)                                         | implemented | P0       | M      | WD-ASHELL-012, RBAC, PLAN    |
| WD-ASHELL-014 | Sidebar rail navigation catalogue and filters                            | implemented | P0       | L      | WD-ASHELL-012, PLAN          |
| WD-ASHELL-015 | Sidebar rail chrome and behaviour                                        | implemented | P1       | M      | WD-ASHELL-014                |
| WD-ASHELL-016 | Sidebar-mode top strip (jump search, greeting, clock)                    | implemented | P1       | M      | WD-ASHELL-014                |
| WD-ASHELL-017 | Workspace switcher (header, rail, mobile)                                | implemented | P0       | M      | WSP                          |
| WD-ASHELL-018 | In-shell notification bell dropdown                                      | implemented | P1       | M      | NOTIF                        |
| WD-ASHELL-019 | Global search palette and profile menu                                   | implemented | P1       | M      | WD-ASHELL-012                |
| WD-ASHELL-020 | More hub page (`/more`) with live counters                               | implemented | P1       | L      | WD-ASHELL-013                |
| WD-ASHELL-021 | More page shortcut strip customizer (browser-local)                      | implemented | P2       | S      | WD-ASHELL-020                |
| WD-ASHELL-022 | Quick access tiles, edge drawer and editor                               | implemented | P2       | M      | WD-ASHELL-012                |
| WD-ASHELL-023 | Guided product tour                                                      | implemented | P2       | M      | WD-ASHELL-013, DASH          |
| WD-ASHELL-024 | Theme switcher and persistence                                           | implemented | P1       | M      | WD-ASHELL-010                |
| WD-ASHELL-025 | Workspace white-label branding in the shell                              | partial     | P2       | M      | WD-ASHELL-036                |
| WD-ASHELL-026 | Announcement bar, trial bar and renewal bar                              | implemented | P1       | M      | PLAN, CMS                    |
| WD-ASHELL-027 | Plan crown badges and in-app paywall sheet                               | implemented | P1       | M      | PLAN                         |
| WD-ASHELL-028 | Global new-message bell widget                                           | implemented | P1       | S      | TIB1                         |
| WD-ASHELL-029 | Connect-device popover                                                   | implemented | P1       | S      | WADEV                        |
| WD-ASHELL-030 | Impersonation banner strip                                               | implemented | P1       | S      | WSP                          |
| WD-ASHELL-031 | UI kit: progress bar, toaster, modals, hints, skeleton, list/grid toggle | implemented | P1       | M      | WD-ASHELL-012                |
| WD-ASHELL-032 | Customer Settings hub and tab shell (`/settings`)                        | implemented | P1       | M      | WD-ASHELL-012                |
| WD-ASHELL-033 | Settings General: workspace name, timezone, currency                     | implemented | P1       | S      | WD-ASHELL-032, WSP           |
| WD-ASHELL-034 | Settings General: working hours card (static)                            | docs-only   | P2       | S      | WD-ASHELL-033                |
| WD-ASHELL-035 | Settings: personal preferences (auto AI summarize)                       | implemented | P2       | S      | WD-ASHELL-032, AICRM         |
| WD-ASHELL-036 | Settings Branding: logo, favicon, brand colours                          | partial     | P2       | M      | WD-ASHELL-032                |
| WD-ASHELL-037 | Settings Team and roles tab (read-only roster)                           | implemented | P2       | S      | WD-ASHELL-032, TIB2          |
| WD-ASHELL-038 | Settings Notifications: per-event and per-category matrix                | implemented | P1       | M      | NOTIF                        |
| WD-ASHELL-039 | Settings AI keys (bring your own key)                                    | implemented | P1       | M      | AIADM, PLAN                  |
| WD-ASHELL-040 | Settings Security: two-factor enrolment and disable                      | implemented | P1       | M      | AUTH                         |
| WD-ASHELL-041 | Settings Security: active sessions and revoke                            | implemented | P1       | M      | AUTH                         |
| WD-ASHELL-042 | Settings API and webhooks tab (informational)                            | partial     | P2       | S      | API, INTG                    |
| WD-ASHELL-043 | Settings Data export (contacts, conversations, messages CSV)             | implemented | P1       | M      | CON, TIB1                    |
| WD-ASHELL-044 | Settings Delete workspace                                                | implemented | P1       | M      | WSP                          |
| WD-ASHELL-045 | Data residency toggle (on the DPA page)                                  | implemented | P2       | S      | I18N                         |
| WD-ASHELL-046 | Settings Appearance: personal theme preference                           | partial     | P2       | S      | WD-ASHELL-024                |
| WD-ASHELL-047 | Unrouted admin prototype pages in AdminPagesController                   | dead-code   | P2       | S      | -                            |

## Features

### WD-ASHELL-001 — Post-login home router (`/home`)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** AUTH login flow, WD-ASHELL-002
- **Summary:** `/home` is the in-app landing router that the login flow and the "Back to app" links use. It sends each signed-in user to the surface that matches their role so nobody lands on a page they cannot use. The public marketing site owns `/`.
- **Actors & access:** any authenticated user (`auth` middleware only). No plan gate. Workspace scope is irrelevant (redirect only).
- **UX & screens:** no screen; a 302 redirect. Order of decision: (1) platform admin (`isAdmin()` true, or legacy `users.role` in `admin|super-admin|super_admin|platform-admin`) -> `/admin`; (2) workspace role `agent` or `viewer` on the current workspace -> `/team-inbox`; (3) everyone else (owner, admin, manager, or a user with no role) -> `/dashboard`.
- **Endpoints:**

| Method + uri | Route name | Controller@action         | Middleware | Request fields | Response                                       |
| ------------ | ---------- | ------------------------- | ---------- | -------------- | ---------------------------------------------- |
| GET `home`   | `home`     | closure in routes/web.php | auth       | none           | 302 to `/admin`, `/team-inbox` or `/dashboard` |

- **Data:** reads `users.role`, Spatie role assignment, `workspace_user.role` for `current_workspace_id`. Writes nothing.
- **Rules & edge cases:**
  1. Platform-admin check swallows exceptions from the Spatie tables (early bootstrap) and falls back to the legacy `role` column.
  2. A platform admin always goes to `/admin`, even when they also belong to workspaces (the admin sidebar's "Back to app" and brand logo go to `/dashboard` explicitly).
  3. QUIRK: manager+ users who cannot open the dashboard for any reason still get `/dashboard`; the redirect does not test plan or trial state.
  4. Agents and viewers who open `/dashboard` directly are bounced by `EnsureWorkspaceRole` (see WD-ASHELL-002 rules), not by this router.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a Super Admin, when they open `/home`, then they are redirected to `/admin`.
  - Given a workspace member whose role is `agent`, when they open `/home`, then they are redirected to `/team-inbox`.
  - Given a workspace owner, when they open `/home`, then they are redirected to `/dashboard`.
  - Given an anonymous visitor, when they open `/home`, then they are redirected to the login page.
- **Source refs:** routes/web.php (closure `home`, lines ~493-512).
- **Port notes:** implement as a Next.js middleware or a tiny `GET /api/session/landing` used after login. Roles come from the RBAC domain; keep the three-way decision in one function shared with the login redirect.

### WD-ASHELL-002 — Admin console access gates (admin role, IP allowlist)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** RBAC (platform roles), SET (security settings)
- **Summary:** Everything under `/admin` (and the BSP admin routes) is reachable only by a signed-in platform admin, optionally from an allow-listed IP range. The same middleware set also gates the customer app by workspace role and plan feature; those semantics are recorded here because the shell's nav mirrors them.
- **Actors & access:** platform admin (`User::isAdmin()`: Spatie `Super Admin` or `Admin`, or legacy `users.role` in `admin|A`). QUIRK: the _Platform Support_ and _Auditor_ Spatie roles (PlatformPermissions::ROLES) are NOT admins for this gate, so they get 403 on `/admin`, even though the customer header shows them the gear icon (see WD-ASHELL-013).
- **UX & screens:** blocked by role -> HTTP 403 "Admins only." Blocked by IP -> 403 rendering `resources/views/errors/ip-blocked` with the caller IP (that view is out of inventory scope).
- **Endpoints:** applies to the whole `admin` route group registered in `bootstrap/app.php` (`web`, `auth`, `admin`, `ip.allowlist`, prefix `admin`, name prefix `admin.`) and to `routes/bsp.php` (`auth`, `admin`).
- **Data:** reads `system_settings` keys `security.ip_allowlist_enabled` (bool, default false) and `security.ip_allowlist_cidrs` (array of strings). Writes an audit row `admin.access.blocked_by_ip` (layer `platform`, result `failure`, meta ip / cidrs_count / path) on block.
- **Rules & edge cases:**
  1. IP allowlist enforces only when enabled AND the CIDR list is non-empty (fail open when empty so an admin cannot lock themselves out).
  2. Entries without `/mask` are exact matches; IPv4 vs IPv6 mismatches never match; masks are compared bytewise then bitwise.
  3. Workspace role gate (`workspace.role:<min>`), used by customer routes: hierarchy owner > admin > manager > agent > viewer. Platform admins bypass. A user with no role and zero workspaces goes to `register.workspace`; a user with workspaces but no role on the current one goes to `/team-inbox`. Below the bar: agent/viewer are redirected to `/team-inbox` with flash warning "Your role (x) doesn't have access to that page."; manager gets HTTP 403 with the same message.
  4. Workspace membership gate (`workspace.member`): no current workspace -> `/workspaces/select`; stale membership -> switch to first remaining workspace or the picker; an active impersonation session is exempt; a suspended workspace (`status=false` or `isSuspended()`) bounces to another active workspace or renders `workspace-suspended` with 403.
  5. Plan gate (`plan:<feature,...>` EnforcePlanFeature): safe requests (GET/HEAD) still render and share a `planPaywall` view variable (see WD-ASHELL-027); mutations return 403 JSON `{ok:false,error:"plan_feature_disabled",feature,message}` for AJAX or a redirect-back with a warning flash otherwise. Labels come from a fixed key->label map with a generic fallback (strip `access_`, underscores to spaces).
- **Async & events:** audit log entry on IP block only.
- **External systems:** none.
- **Settings:** `security.ip_allowlist_enabled`, `security.ip_allowlist_cidrs` (admin Security page, owned by SET/AUTH).
- **Acceptance criteria:**
  - Given a signed-in workspace owner without an admin role, when they request `/admin`, then the response is 403.
  - Given the allowlist enabled with CIDR `10.0.0.0/8` and a request from `192.168.1.5`, when an admin requests `/admin`, then the response is 403 and an `admin.access.blocked_by_ip` audit row exists.
  - Given the allowlist enabled with an empty list, when an admin requests `/admin`, then access is allowed.
  - Given an agent, when they request `/dashboard`, then they are redirected to `/team-inbox` with a warning flash.
  - Given a manager, when they request an admin-tier route, then the response is 403.
- **Source refs:** app/Http/Middleware/EnsureUserIsAdmin.php, IPAllowlist.php, EnsureWorkspaceRole.php, EnsureWorkspaceMembership.php, EnforcePlanFeature.php; bootstrap/app.php; app/Support/PlatformPermissions.php; app/Models/User.php (`isAdmin`, `workspaceRole`).
- **Port notes:** RBAC domain owns roles; expose a `PlatformAdminGuard` (Nest guard) plus an `IpAllowlistGuard` reading tenant-less platform settings. Decide explicitly whether Platform Support/Auditor should see `/admin` (WaDesk accidentally locks them out; the header gear icon suggests intent to allow them). Impersonation exemptions must be carried into the workspace-membership guard.

### WD-ASHELL-003 — Admin layout shell and page-chrome contract

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-ASHELL-002
- **Summary:** One Blade layout wraps every admin page: a 260px left sidebar (drawer on mobile), a right-hand content column and shared head metadata. Each admin page passes a title and an `adminKey` that highlights its sidebar item.
- **Actors & access:** platform admins only (WD-ASHELL-002). No workspace scope; no plan gates.
- **UX & screens:** `resources/views/components/layouts/admin.blade.php`. Props: `title` (default "Dashboard"), `adminKey` (default `overview`, sets `body[data-admin]`), `page` (optional `body[data-page]` used to lazy-load a page-specific JS initializer). Document title is "<title> - <brand> Admin". Grid: `md:grid-cols-[260px_minmax(0,1fr)]`. Head emits: csrf token meta, `app-base` (sub-folder deploy prefix), default country code+iso meta, `currency-symbol` meta (platform default currency), favicon (Brand), SEO meta (title override), PWA meta, theme bootstrap (localStorage `wa-theme` -> `data-theme`), `window.WADESK_BRAND` (per-theme logo URLs for paper/bright/dark/doodle plus app name), `window.WADESK_USER` (name, email, role, isAdmin, initials), the Vite bundle, app font partial and finally the admin theme-colour overrides (`theme_css()`), placed last so they win. `<html>` gets `lang`, `dir` (RTL for RTL locales via `LocaleSettings::directionFor`) and class `admin-sidebar-collapsed` when the `wa_admin_sidebar` cookie equals `collapsed`. Visitor analytics scripts and the cookie-consent banner are deliberately NOT rendered in admin. A hidden logout form `#logoutForm` (POST logout) is included for JS logout links.
- **Endpoints:** none of its own.
- **Data:** reads system settings for brand name, favicon, logos, default country/currency; cookie `wa_admin_sidebar`.
- **Rules & edge cases:**
  1. Pages must render a `<header>` containing an element with attribute `data-admin-header-right`; a small inline script moves the shared header-right control set into it before paint (WD-ASHELL-006) and, on mobile, injects a hamburger button and hides the first child (breadcrumb) below `md`.
  2. If the page header has no search input, the script injects a decorative search box ("Search admin...", `CMD K` hint) hidden below `md`. QUIRK: that injected input has no handler of its own; only the global Ctrl/Cmd+K palette (WD-ASHELL-019) is functional. Pages that ship their own search input get it hidden on mobile instead.
  3. Body has `overflow-x-clip`; the sidebar backdrop click closes the drawer and restores body scroll.
  4. Page-specific JS is selected by `body[data-page]` in `resources/js/app.js` (a map of dynamic imports); `initAdminSidebar()` runs only when `body[data-admin]` exists.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `app_name`, `brand.favicon`, per-theme logos, `default_currency`, theme colour overrides (WD-ASHELL-010).
- **Acceptance criteria:**
  - Given an admin page rendered with `adminKey=users`, when the page loads, then the Users child in the sidebar is highlighted and its group is expanded.
  - Given an RTL locale, when any admin page loads, then `<html dir="rtl">`.
  - Given a viewport under 768px, when the page loads, then the sidebar is off-canvas and a hamburger opens it with a dimmed backdrop.
  - Given the admin changes a theme colour token, when any admin page loads, then the override style block is the last item in `<head>`.
- **Source refs:** resources/views/components/layouts/admin.blade.php, resources/js/app.js, resources/js/wadesk.js, resources/views/partials/app-font.blade.php, resources/views/components/theme-bootstrap.blade.php.
- **Port notes:** a Next.js `(admin)/layout.tsx` with a client sidebar and a `PageHeader` component that owns the right-slot instead of DOM-moving nodes. Keep `adminKey` as a route-segment-derived active key. Use a cookie for sidebar state so SSR can render it collapsed without flash.

### WD-ASHELL-004 — Admin sidebar navigation with live counts

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-ASHELL-003, ADD (extension nav)
- **Summary:** The admin rail lists every operational area as leaves and expandable groups, each with a live count badge, plus a "System" block and a "Back to app" footer. The menu is fixed in code (no per-permission filtering, no per-role variants).
- **Actors & access:** platform admins. No plan or permission filtering inside the console: every admin sees every item.
- **UX & screens:** `resources/views/components/admin/sidebar.blade.php`. Brand header: per-theme logo (`data-brand-logo`) or an SVG mark plus name and the caption "Admin console"; links to `/dashboard`. Section "Main menu":
  - Leaves: Overview (`/admin`, key `overview`), Financial (`financial`), Premium (`premium`), Analytics (`analytics`), AI Dashboard (`ai-dashboard`), System Health (`health`).
  - Group "Users & access" (key `access`): Users, Roles, Permissions, Devices (badges: user count, role count, permission count, device count).
  - Leaf Workspaces (badge: workspace count).
  - Group "Billing & plans": Packages, Add-ons, Coupons, Billing history, Order history, Invoices, Billing settings (`checkout-settings`), Message pricing (`wallet-rules` -> `/admin/settings/wallet-rules`), Message income (`bsp`), Reseller billing (Meta) (`bsp-credit`).
  - Group "Support" (coral badge = open tickets + unread contact messages): Inbox (`support`), Contact inbox (`contact-messages`), Team inbox (`support-team` -> `/admin/support/team-inbox`), Agents, SLA board, Customers, Playbooks, Reports.
  - Group "Marketing": Announcements, Guidebook.
  - Section "System": Channel Settings (`/admin/settings/channel-setting`), Frontend editor, Security, Storage, Real-time (`/admin/settings/realtime`), Blog, Flow templates, Settings (`/admin/settings`), then extension-contributed items (ADD) appended in registration order.
  - Footer: "Back to app" link to `/dashboard` with a static green "online" dot (not a real health signal).
- **Endpoints:** none of its own (links only). Each target belongs to another domain (users/roles/permissions -> RBAC/AUTH, workspaces -> WSP, packages/coupons/credit -> PLAN/CPN, support -> SUPP, blog/frontend/announcements/guidebook -> CMS, storage/realtime/security/settings -> SET, health/financial/premium/analytics/ai-dashboard -> DASH, devices -> WADEV, add-ons -> ADD, flow templates -> FLB).
- **Data:** count queries computed on EVERY render (no cache), each wrapped in try/catch so a missing table only blanks its badge: users, devices, roles, permissions, workspaces, packages, add-on packages (`Package::addons()`), active coupons (uses `is_active` when the column exists), all orders (used for Billing history AND Order history), paid orders (Invoices), open support tickets (`open|in_progress|pending`), unassigned open/pending tickets (Team inbox badge uses `open|pending|in_progress`), unread contact messages (`is_read=false`), active support agents, SLA-at-risk tickets (open-like with `first_response_at` null), distinct ticket emails (Customers), active playbooks, active announcements, published guidebook articles.
- **Rules & edge cases:**
  1. Count formatter: `>=1000` -> `1.2k` (no decimals from 10k), `>=1M` -> `1.2M`; counts of 0 render no badge.
  2. Support group badge = open tickets + unread contact messages, styled coral; SLA badge coral only when >0.
  3. A group is expanded server-side when it holds the active key (or its own key equals active); other groups start collapsed; toggling is client-side (WD-ASHELL-005).
  4. Extension items: `ExtensionRegistry::nav('admin')` items (`key,href,label,icon,sw`) are appended to the System block; the item with key `instagram` is skipped because Instagram now appears as a card on Channel Settings. Extension hrefs are forced to app-relative URLs.
  5. Several pages exist with no sidebar entry (Credit packages, Translation providers/usage, Meta Ads keys, Pricing FAQs, Languages, Currencies, Payment gateways, API keys, Audit log, Legal pages, Updater, Extensions...). They are reachable through Settings hub tiles (WD-ASHELL-008) or direct URL only. The comment in source says Contacts / Meta Ads / Messaging / Platform entries were removed on purpose and must not be re-added until real pages exist.
  6. QUIRK: Billing history and Order history badges show the same number (total orders); Invoices counts only paid orders.
  7. Performance: ~20 `COUNT` queries per admin page view; port as one cached aggregate (short TTL) or lazy client fetch.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none directly; extension enable state (ADD).
- **Acceptance criteria:**
  - Given 12,500 users, when the sidebar renders, then the Users badge reads `12.5k`.
  - Given 3 open tickets and 2 unread contact messages, when the sidebar renders, then the Support group badge reads `5` in the coral style.
  - Given an installed extension whose manifest declares an admin nav item, when the sidebar renders, then that item appears at the end of the System block; when the extension is disabled, then it disappears without a code change.
  - Given the active key is `support-sla`, when the sidebar renders, then the Support group is expanded and only that child is highlighted.
  - Given a missing `announcements` table, when the sidebar renders, then the page still renders and the Announcements badge is blank.
- **Source refs:** resources/views/components/admin/sidebar.blade.php, app/Services/ExtensionRegistry.php (`nav`), routes/admin.php.
- **Port notes:** define the nav as data (typed array in `packages/contracts` or web app) with optional `badgeKey`; back the badges with one `GET /admin/nav-counts` endpoint. Because the target has RBAC, decide whether to filter by platform permission (WaDesk does not). Extensions/add-ons become a registry feed.

### WD-ASHELL-005 — Admin sidebar collapse, group toggles, mobile drawer

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-ASHELL-004
- **Summary:** Admins can collapse the rail to icons on desktop, expand or collapse groups, and on phones open the rail as a drawer.
- **Actors & access:** platform admins.
- **UX & screens:** collapse button `#admin-sidebar-toggle` in the brand header (icon of a panel with chevron). Desktop: toggles class `admin-sidebar-collapsed` on `<html>` and sets cookie `wa_admin_sidebar=collapsed|expanded` (path `/`, one year, SameSite=Lax) and updates the button aria-label/title ("Collapse sidebar" / "Expand sidebar"). Elements with class `js-sb-collapse-hide` (labels, captions, "Back to app" text) are hidden by CSS in collapsed state (CSS in `resources/css/wadesk.css`). Mobile (<768px): the same button CLOSES the drawer instead (slides `-translate-x-full`, fades the backdrop, restores body scroll); the header hamburger (injected, see WD-ASHELL-003) opens it and locks body scroll; tapping the backdrop closes it. Group buttons (`data-admin-toggle`) toggle their child list and rotate the chevron 180 degrees.
- **Endpoints:** none.
- **Data:** cookie only (not stored per user in DB).
- **Rules & edge cases:**
  1. Cookie is read server-side (`$_COOKIE`) to render the collapsed class on first paint (no flash).
  2. Group open/closed state is NOT persisted; each page load re-opens only the active group.
  3. The listener is attached once per element (`dataset.wired`).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the rail is expanded on desktop, when the admin clicks the collapse button and reloads, then the rail renders collapsed without a flash.
  - Given a phone viewport, when the admin taps the hamburger, then the rail slides in with a backdrop and body scrolling is locked; tapping the backdrop closes it.
  - Given a group is collapsed, when the admin clicks its header, then children show and the chevron rotates.
- **Source refs:** resources/js/admin-sidebar.js, resources/views/components/layouts/admin.blade.php, resources/views/components/admin/sidebar.blade.php.
- **Port notes:** trivial in React; persist collapse in a cookie for SSR. Keep the mobile drawer separate from the desktop collapse.

### WD-ASHELL-006 — Admin header controls (health pill, theme, language, bell, user menu)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-ASHELL-003, NOTIF
- **Summary:** A shared control cluster in every admin page header: platform-health pill, back-to-app button, theme switcher, language switcher, platform notification bell and an account menu.
- **Actors & access:** platform admins.
- **UX & screens:** `resources/views/components/admin/header-right.blade.php`, rendered once in a hidden `#admin-header-right-source` and moved into `[data-admin-header-right]`.
  - **Health pill** (hidden below md): green "All systems normal", amber "N stuck jobs", red "Database unreachable"; links to `/admin/security`. Probe = DB `getPdo()`; then `jobs` rows with `reserved_at` older than 10 minutes (missing `jobs` table is fine). No remote calls.
  - **Back to app** icon -> `/dashboard`.
  - **Theme button** `#wa-theme-btn` (see WD-ASHELL-024).
  - **Locale switcher** (renders only when more than one active language; I18N owns it).
  - **Bell** `#notif-toggle` with badge `#notif-badge` (`99+` cap). Pane lists items from `GET admin/notifications/recent` (`{items:[{id,title,message,severity,unread,action_url,time_ago}], unread}`); severity `error|critical` coral, `warning` amber; unread dot; empty copy "No notifications yet."; "Mark all read" -> POST `admin/notifications/read-all`; "Clear all" -> DELETE `admin/notifications`; "View all" -> `/admin/notifications`. Loads on open and every 60 s while the tab is visible; the pane is pinned to viewport edges on mobile.
  - **Avatar menu**: initials (first letters of first two words), name, role label (first Spatie role name, else `users.role` prettified, else "Member"); menu: email, My account (`/account`), Settings (`/settings`), Admin overview (`/admin`), Sign out (POST logout).
- **Endpoints:** consumes `admin.notifications.recent|read-all|clear` (NOTIF owns), `logout` (AUTH).
- **Data:** reads `jobs`; feed data belongs to NOTIF.
- **Rules & edge cases:** outside-click closes user and bell panes; pane clicks stop propagation; fetch failures are silent; the bell script is inline in the layout (admin), separate from the user-side copy (WD-ASHELL-018).
- **Async & events:** 60 s polling (visibility aware).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a `jobs` row reserved 15 minutes ago, when an admin page loads, then the pill shows "1 stuck jobs" in amber.
  - Given 120 unread platform notifications, when the header loads, then the badge shows `99+`.
  - Given the admin clicks "Mark all read", when the request succeeds, then the list reloads with no unread dots and the badge hides.
- **Source refs:** resources/views/components/admin/header-right.blade.php, resources/views/components/layouts/admin.blade.php (inline script).
- **Port notes:** build one `HeaderControls` client component shared with the customer shell, parameterised by feed endpoint. Health pill needs a cheap platform-health endpoint (DB ping, queue stuck-job count from BullMQ).

### WD-ASHELL-007 — Admin flash toast and inline flash banner

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-ASHELL-003
- **Summary:** After any admin save the layout shows a floating toast for the session message, and pages can also drop an inline banner component.
- **Actors & access:** platform admins.
- **UX & screens:** layout toast `#admin-flash-toast` (fixed top-right, max-w-md): green style for `session('success')` or `session('status')`, coral style for `session('error')`; icon check or alert; close button; auto-dismisses after 4 s with a 0.3 s fade; `role=status aria-live=polite`. Inline component `components/admin/flash.blade.php` renders `status|success` (mint), `error` (coral) and `warning` (amber) banners, optional `inline` compact mode.
- **Endpoints:** none.
- **Data:** session flash keys `success`, `status`, `error`, `warning`.
- **Rules & edge cases:** error wins over success when both are set; `warning` is only shown by the inline component (the toast ignores it). Some pages render both toast and inline banner.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a controller redirects with `success`, when the next admin page loads, then a green toast appears and disappears after ~4 s.
  - Given both `success` and `error`, when the page loads, then only the error text is shown.
  - Given `warning` only, when the page loads, then no toast is shown but pages embedding the inline component show an amber banner.
- **Source refs:** resources/views/components/layouts/admin.blade.php, resources/views/components/admin/flash.blade.php.
- **Port notes:** replace session flash with a toast library fed by mutation results; keep a `warning` variant.

### WD-ASHELL-008 — Admin settings hub (tile index and KPI strip)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-ASHELL-003, SET
- **Summary:** `/admin/settings` is the landing page for "Project settings": a KPI strip about stored settings, quick buttons, a searchable grid of tiles that jump to each settings sub-page, and the "Sending providers" form. This entry covers the hub page itself and its navigation role; each sub-page is owned by another domain.
- **Actors & access:** platform admins.
- **UX & screens:** `resources/views/admin/settings/index.blade.php`. Header with breadcrumb and a "Search project settings..." box (with `CMD K` hint) that filters tiles client-side. Buttons: Add-ons (`admin.extensions.index`), Updater (`admin.update.index`), Legal pages, Open general, Export config (`admin.settings.export`). KPI cards: saved settings rows in `system_settings`; healthy (rows with non-empty value); needs-test list (mail if `mail_host` set but no successful audit `settings.mail_test`; catalog if `catalog_enabled` and no `settings.catalog_test`; shopify if `shopify_enabled` and no `shopify.oauth_completed`; else "all verified"); secret fields (non-empty rows whose key ends in `_secret|_password|_token|_apikey|_api_key`); last updated (max `updated_at`) and by whom (latest audit row with action like `settings.%`). Tiles, ordered most-used first: Appearance and colours, General settings, Payment gateways, Currencies, AI/API keys, Mail settings, Audit log, Privacy GDPR and ADA, Menu order, Auth pages, Analytics integrations, SEO, Languages, PWA, Catalog, Shopify, WooCommerce, HubSpot, Google integration, Slack, Mobile push (FCM), Trello, Footer, Site info, Social login and captcha; then the "Sending providers" section (allowed send methods WABA/Unofficial/Twilio checkboxes, default method, WABA embedded-signup credentials, Node bridge server URL, Twilio credentials) posting to `admin.settings.providers.update` (owned by WADEV/SET).
- **Endpoints:**

| Method + uri         | Route name             | Controller@action             | Middleware                | Request fields | Response |
| -------------------- | ---------------------- | ----------------------------- | ------------------------- | -------------- | -------- |
| GET `admin/settings` | `admin.settings.index` | AdminPagesController@settings | auth, admin, ip.allowlist | none           | HTML     |

- **Data:** reads `system_settings` (all rows, for KPIs), `audit_logs` (action filters), `wa_provider_configs` (count of connected WABA rows), and dozens of keys to populate the providers form: `referral_signup_credits`(100), `credits_per_message`(1), `credits_per_currency_minor`(0.1), `default_send_method`(baileys), `allowed_send_methods`(["waba","baileys","twilio"]), waba_app_id, waba_config_id, waba_coexistence, waba_webhook_verify_token, baileys_server_url (env SERVER_URL fallback), twilio_*, waba_dispatch_v2_enabled, waba_graph_api_version (v23.0), waba_templates_v2_enabled, waba_template_polling_min (30), waba_template_lint_strict (true), pacing msg_gap(3), batches_gap(50), bw_msg_gap(5), enable_batches(false), campaign_auto_expiry_enabled(true), campaign_default_expiry_hours(24).
- **Rules & edge cases:**
  1. Secrets are never echoed: `waba_app_secret` and `twilio_auth_token` are exposed only as "is set" booleans.
  2. Every audit/needs-test lookup is try/caught so a missing table only empties a KPI.
  3. QUIRK: the doc page and the tile say Appearance lives at `/admin/appearance`; the real route is `/admin/settings/appearance` (WD-ASHELL-010).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** see Data.
- **Acceptance criteria:**
  - Given `mail_host` is configured and no successful mail test is audited, when an admin opens the hub, then "Needs test" lists `mail`.
  - Given the admin types "ana" into the tile search, when the field changes, then only tiles whose text matches remain visible.
  - Given a `waba_app_secret` value exists, when the hub renders, then the secret is not present in the HTML, only a "set" indicator.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (`settings`, lines ~1430-1527), resources/views/admin/settings/index.blade.php.
- **Port notes:** the hub is a static nav + KPI query; the providers form belongs to the provider-settings work in WADEV/WABA. Keep the tile list as data so add-ons can contribute tiles.

### WD-ASHELL-009 — Menu layout editor (user top bar vs More)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-ASHELL-013
- **Summary:** An admin decides which customer pages sit in the top navigation bar (and in what order) and which live on the More page. It is one global setting for all customers.
- **Actors & access:** platform admins. Affects topbar mode only (sidebar mode ignores it, see WD-ASHELL-014).
- **UX & screens:** `resources/views/admin/settings/menu-order.blade.php` + `_menu_chip.blade.php`. Two drop zones: "Top navigation bar" and "More menu", each a list of chips (label, description, drag handle, a move button that swaps zone). "More" is locked in the bar. A live preview strip mimics the header. Buttons: Save layout, Reset layout (client-side, loads the "factory bar" list `dashboard, wa-campaigns, flows, templates, metaads, devices, more`), Cancel, All settings. Counts badge per zone; tip recommends about 6 bar items. Editor-known items (24): bar by default = dashboard, wa-campaigns, flows, templates, metaads, devices, more(locked); more zone by default = broadcasts, contacts, team-inbox, deals, chat, analytics, auto-reply, scheduled, message-history, ai-assistants, ai-training, wa-links, chatbot-widgets, webhooks, integrations, warmer, call-logs, support.
- **Endpoints:**

| Method + uri                     | Route name                         | Controller@action                           | Middleware                | Request fields             | Response                                                                            |
| -------------------------------- | ---------------------------------- | ------------------------------------------- | ------------------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| GET `admin/settings/menu-order`  | `admin.settings.menu-order`        | AdminPagesController@settingMenuOrder       | auth, admin, ip.allowlist | none                       | HTML (items, bar, more)                                                             |
| POST `admin/settings/menu-order` | `admin.settings.menu-order.update` | AdminPagesController@settingMenuOrderUpdate | same                      | `bar[]` array of item keys | redirect back with flash "Menu layout saved. Users see it on their next page load." |

- **Data:** `system_settings.user_nav_order` (type json, description "User panel top-bar items + order"), stored as `{"bar":["dashboard",...,"more"]}`. Legacy format was a flat key array meaning "reorder, show all"; still read by the header (WD-ASHELL-013) and by the editor (filtered to bar-zone keys).
- **Rules & edge cases:**
  1. Submitted keys are filtered to the 24 known keys, de-duplicated, order preserved; `more` is appended if missing (cannot be removed).
  2. Resolution when loading the editor: new format uses `bar`; legacy flat list keeps only default-bar keys; empty/invalid -> default bar; `more` always present. The "More zone" is every known key not in the bar, in canonical order.
  3. QUIRK (default mismatch): with NO saved config the real header shows `dashboard, team-inbox, wa-campaigns, flows, templates, devices, more` (Meta Ads is promo-hidden, Unified Inbox is in the bar), but the editor's default zones put `metaads` in the bar and `team-inbox` in More, and "Reset layout" restores the editor's list. Saving the editor untouched therefore silently swaps Unified Inbox for Meta Ads in every customer header. The More page's demoted-nav logic also assumes the header default includes `team-inbox` (WD-ASHELL-020). Port should have one canonical default list.
  4. QUIRK: header catalogue items with no editor entry (crm, ai-crm, companies, payments, tasks, projects, proposals, estimates, calendar) can never be promoted into the bar through this UI; if a saved bar omits them they are simply hidden from the bar (they remain reachable from the CRM hub and the /more page).
  5. Per-user visibility (role tier, plan, engine) still applies on top of the saved bar; the editor cannot grant access.
  6. The "Menu order" tile blurb says "sequence of top navigation items"; the page really controls bar membership too.
- **Async & events:** none (takes effect on the next customer page load; no cache bust needed because the setting is read per request).
- **External systems:** none.
- **Settings:** `user_nav_order`.
- **Acceptance criteria:**
  - Given the admin moves Broadcasts into the bar after Flows and saves, when a manager loads any customer page in topbar mode, then Broadcasts appears right after Flows.
  - Given a POST without `more`, when saved, then the stored bar still ends with `more`.
  - Given a POST containing an unknown key `foo`, when saved, then `foo` is not stored.
  - Given the layout is reset then saved, when compared to a fresh install, then the two bars are identical (port must fix the WaDesk mismatch).
- **Source refs:** app/Http/Controllers/AdminPagesController.php (`userNavItems`, `resolvedNavBar`, `settingMenuOrder*`, ~3760-3827), resources/views/admin/settings/menu-order.blade.php, _menu_chip.blade.php, resources/views/components/user/header.blade.php.
- **Port notes:** store per-platform (tenant-less) config row `nav.bar`; expose `GET/PUT /admin/settings/nav`. Ship one shared nav catalogue (key, label, tier, feature, promo flag) used by header, More, editor.

### WD-ASHELL-010 — Appearance: dashboard colour tokens and interface metrics

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-ASHELL-024
- **Summary:** Platform admins recolour the whole product (customer app and admin console) by overriding 16 design tokens, and scale interface size and opacity, with a live preview. Saved values are injected as CSS custom properties at the end of every layout's head; no rebuild is needed.
- **Actors & access:** platform admins. The doc page also says "admin sidebar under Appearance"; there is no such sidebar item (reach it from the Settings hub tile).
- **UX & screens:** `resources/views/admin/settings/appearance.blade.php` + `resources/js/charts/admin-settings-appearance.js`. Sections: (a) User dashboard navigation layout (WD-ASHELL-011), (b) sidebar colours (WD-ASHELL-011), (c) "Interface" sliders: Font size 80-130% (default 100) and Opacity 55-100% (default 100), with plus/minus steppers, (d) colour token groups Brand / Surfaces / Text / Accents with a native colour input per token, (e) live preview panel that scopes `--color-*` vars and applies damped zoom (half the deviation) and opacity to a mock, (f) quick-guide, Reset-to-defaults card. Confirmation prompt before reset.
  Tokens (suffix => label, default): wa-deep Primary #075E54, wa-teal Primary (hover) #128C7E, wa-green Accent/success #25D366, wa-mint Soft accent fill #DCF8C6, wa-bubble Chat bubble #E7FFDB, paper-0 Page background #FBFAF6, paper-50 Card/muted bg #F5F3EC, paper-100 Hover background #EFEBE0, paper-200 Borders #E5DFD0, ink-500 Muted text #6B807C, ink-700 Body text #1F4540, ink-900 Headings #0B1F1C, accent-coral #E87A5D, accent-amber #E5A04E, accent-plum #5B3D8A, accent-sky #3E7AA1.
- **Endpoints:**

| Method + uri                           | Route name                         | Controller@action                 | Middleware                | Request fields                           | Response                                                                                                                             |
| -------------------------------------- | ---------------------------------- | --------------------------------- | ------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| GET `admin/settings/appearance`        | `admin.settings.appearance`        | Admin\AppearanceController@index  | auth, admin, ip.allowlist | none                                     | HTML                                                                                                                                 |
| POST `admin/settings/appearance`       | `admin.settings.appearance.update` | Admin\AppearanceController@update | same                      | `colors[token]` hex; `metrics[font-scale | ui-opacity]`int;`user_dashboard_layout`; `user_sidebar_color`, `user_sidebar_text_color`, `user_sidebar_accent_color`(+`_use` flags) | back with status "Appearance saved - the whole dashboard has been updated." |
| POST `admin/settings/appearance/reset` | `admin.settings.appearance.reset`  | Admin\AppearanceController@reset  | same                      | none                                     | back with status "Appearance reset to the shipped defaults."                                                                         |

- **Data:** `system_settings` keys `theme.color.<token>` (string, blank = default) and `theme.metric.font-scale|ui-opacity` (integer percent), plus the shell keys in WD-ASHELL-011.
- **Rules & edge cases:**
  1. Colour value accepted only if it matches `#` + 3 to 8 hex digits; anything else is stored as empty (default). Values equal (case-insensitive) to the shipped default are NOT emitted as overrides.
  2. Metrics are clamped server-side to their declared range, ignored when blank or non-numeric (protects against zoom 0). Reset sets metrics back to 100 and clears all colours.
  3. `theme_css()` emits a single `<style id="wa-theme-overrides">` `:root{...}` block. If the primary `wa-deep` is overridden and hover/accent/mint/bubble are not, they are DERIVED: teal = oklch lightness +0.08, green = oklch 0.72 lightness, mint = 16% of primary mixed with white, bubble = 10%; explicit overrides win. Font scale is applied as `html{zoom:X}` (because the codebase sizes type in px, not rem) and opacity as `body{opacity:X}`.
  4. Any exception while building the block returns an empty string (page still renders).
  5. Tokens apply to BOTH shells; JS colour helpers (`themeColor`, `themeAlpha`, `chartPalette`, `chartInk` in `theme-colors.js`) read the live computed `--color-*` so charts recolour too, with hard-coded fallbacks if a token is missing.
  6. QUIRK: docs and hub text say `/admin/appearance`; actual URI is `/admin/settings/appearance`.
  7. QUIRK: the four brand tokens are "derived" only when primary is overridden; recolouring via the customer Branding tab (WD-ASHELL-036) uses different CSS variables and `!important` class rewrites.
- **Async & events:** audit not written (no audit call in controller).
- **External systems:** none.
- **Settings:** `theme.color.*`, `theme.metric.*`.
- **Acceptance criteria:**
  - Given the admin sets Primary to `#5B3D8A` and saves, when any user or admin page loads, then `--color-wa-deep` is `#5B3D8A` and the hover/accent/mint/bubble tokens are derived from it.
  - Given a POST with `colors[wa-deep]=notacolor`, when saved, then the override is cleared.
  - Given a POST with `metrics[font-scale]=0`, when saved, then the stored value is clamped to 80.
  - Given the admin clicks Reset and confirms, when the page reloads, then no `wa-theme-overrides` style is rendered and metrics read 100.
- **Source refs:** app/Http/Controllers/Admin/AppearanceController.php, app/Support/fc_helpers.php (`theme_palette`, `theme_color`, `theme_metrics`, `theme_metric`, `theme_css`), resources/views/admin/settings/appearance.blade.php, resources/js/charts/admin-settings-appearance.js, resources/js/theme-colors.js, Documentation/pages/admin-panel/appearance.html.
- **Port notes:** store tokens in a tenant-less `platform_settings`; serve as a CSS-variable stylesheet or inline style in the root layout. Use Tailwind v4 `@theme` variables in the Next app so the same token names apply. Do not reuse `html{zoom}` blindly (non-standard); prefer `font-size` on `html` with rem-based sizing.

### WD-ASHELL-011 — User shell mode (topbar or sidebar) and rail colours

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-ASHELL-010, WD-ASHELL-012
- **Summary:** One global switch decides whether every customer sees the classic top header with a More page, or an admin-style left rail with all pages grouped. In sidebar mode the admin can also set the rail background, text and accent colours.
- **Actors & access:** platform admins configure; customers experience. Same endpoints as WD-ASHELL-010.
- **UX & screens:** two selectable cards "Top bar" (Current - menu across the top plus a More page for overflow) and "Sidebar" (Admin-style left rail with all features grouped, no top menu). Sidebar colours: Background colour input (always posted), Text colour and Accent colour each with a "Custom" checkbox; unticking sends a hidden `_use=0` so the value is cleared (native colour inputs always post a value).
- **Endpoints:** POST `admin/settings/appearance` (see WD-ASHELL-010).
- **Data:** `system_settings`: `user_dashboard_layout` (`topbar`|`sidebar`; anything else reads as `topbar`), `user_sidebar_color` (hex6 or blank, default rendered `#06100E`), `user_sidebar_text_color` (hex6 or blank = auto contrast), `user_sidebar_accent_color` (hex6 or blank = `#25D366`).
- **Rules & edge cases:**
  1. Layout accepted only when `topbar` or `sidebar`; otherwise unchanged.
  2. Colour values must be exactly `#RRGGBB`.
  3. Rail contrast: luminance = 0.299R + 0.587G + 0.114B over 255; above 0.6 the rail is "light" and uses dark text tokens; below uses light text. An explicit text colour derives the whole token scale (72% / 50% / 42% / 8% / 6% / 14% alphas).
  4. Without a custom background the rail follows the active theme (paper = light default rail, bright = white, doodle = soft green `#EDF6E7`, dark = dark rail); with a custom background the rail is fixed to that colour on every theme.
  5. QUIRK: the background colour input is not optional (no `_use` flag). Any save of the Appearance form posts a colour (the placeholder `#06100E` when never set), so after the first save `hasCustomBg` is true and the rail stops adapting to the theme switcher. Port: give the background the same "Custom" checkbox.
  6. The mode is read per request via `UserNav::layout()`; also emitted as `<html data-user-shell="...">` for CSS hooks.
  7. Pages that pass `hide-header` (Team Inbox, Flow Builder) render with NO rail and NO header in sidebar mode as well as topbar mode (see WD-ASHELL-012).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** the four keys above.
- **Acceptance criteria:**
  - Given `user_dashboard_layout=sidebar`, when a manager opens `/dashboard`, then a left rail renders and no top header or More gateway is shown.
  - Given a rail background `#FFFFFF` and no text colour, when the rail renders, then text tokens are dark.
  - Given "Custom" is unticked for accent and saved, when the rail renders, then the accent is `#25D366`.
  - Given `user_dashboard_layout` holds `grid`, when any page renders, then topbar mode is used.
- **Source refs:** app/Http/Controllers/Admin/AppearanceController.php, app/Support/UserNav.php (`layout`), resources/views/components/user/sidebar-rail.blade.php, resources/views/components/layouts/user.blade.php.
- **Port notes:** a `shell_mode` enum in platform settings plus a typed `railTheme` JSON. Consider making mode per-tenant later; WaDesk is global-only.

### WD-ASHELL-012 — User layout shell (head, boot globals, slots, hideHeader)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-ASHELL-011, WSP, I18N, SET
- **Summary:** One Blade layout (`components/layouts/user`) wraps every signed-in customer page. It resolves theme, workspace brand, real-time keys, boot globals and the chosen navigation mode, then renders banners, nav, the page slot and the floating global widgets.
- **Actors & access:** any authenticated user; the content of the nav depends on workspace role, plan and settings (WD-ASHELL-013/014). Workspace scoped to `users.current_workspace_id`.
- **UX & screens:** `resources/views/components/layouts/user.blade.php`. Props: `title` (default "Dashboard"), `navKey` (default `dashboard`; highlights nav, sets `body[data-nav]`, also gates the inbox bell), `page` (`body[data-page]` picks the JS initializer), `hideHeader` (bool). `<html>` carries `lang`, `dir` and `data-user-shell` (topbar|sidebar). Head: csrf meta; real-time meta (`ws-id` = current workspace id, `pusher-key`, `pusher-cluster`, empty when the admin has not enabled real-time so Echo stays off and pages fall back to polling); `app-base`; default country code/iso; `currency-symbol` (workspace override then platform default); favicon; a `wa-flash` meta that turns a session flash into a toast (variant error > warn > success; message = error ?? warning ?? success ?? status); title "<title> - <brand>"; SEO meta; PWA meta (the Team Inbox page swaps in its own scoped manifest when the `ti_pwa_enabled` setting is on); visitor analytics partial; theme bootstrap; `window.WADESK_BRAND`; workspace brand CSS (WD-ASHELL-025); `window.WADESK_USER` (name, email, role, isAdmin, initials, credits, creditsPerMessage, walletMoney (formatted with workspace currency), referralCode, plan label, roleLabel (workspace owner / admin / member), appName, version); `window.WADESK_TOUR` (WD-ASHELL-023); a tiny `window.t(en)` i18n helper backed by `window.__i18n` (partials.js-i18n fills it per page); Vite bundle; app font; admin theme overrides last. `<body>` gets `data-nav`, `data-page`, `data-theme` (server theme, WD-ASHELL-024).
  Body composition, in order: impersonation strip (WD-ASHELL-030); then EITHER sidebar mode (when mode is `sidebar` AND `hideHeader` is false): fixed-height flex row = rail `aside#user-rail` (260px, drawer on mobile) + main column [announcement bar, trial/renewal bar, top strip, scrolling content]; OR topbar mode: [announcement bar, trial/renewal bar, header] (bars and header skipped when `hideHeader`) then the slot. After that, always: plan paywall sheet (WD-ASHELL-027), connect-device sheet (WD-ASHELL-029), cookie consent partial, `@stack('scripts')`, and for signed-in users a hidden `#logoutForm`, the inbox bell (every page except `navKey=team-inbox`, WD-ASHELL-028), the quick-access drawer and editor modal (WD-ASHELL-022).
- **Endpoints:** none of its own.
- **Data:** reads `users`, `workspaces`, packages (plan label via `billingPackage()->pname`, else "Free"), system settings (`user_dashboard_layout`, realtime keys, `credits_per_message`, `ti_pwa_enabled`).
- **Rules & edge cases:**
  1. `hideHeader` is used by Team Inbox and the Flow Builder (full-screen canvases). In sidebar mode these pages ALSO lose the rail (the sidebar branch requires `!hideHeader`), so there is no nav at all on them; users leave via the browser or an in-page link.
  2. Sidebar mode has its own inline script: drawer open/close, user menu toggle, workspace menu toggle, click-outside closing, collapsible groups persisted in `localStorage['wd_rail_collapsed']` (except the group holding the active page, which is always expanded), rail scroll position persisted in `sessionStorage['wd_rail_scroll']` and the active link scrolled into view.
  3. The layout also renders on error pages, so it must tolerate a missing user (`auth()->user()?->`); the top strip once crashed here.
  4. QUIRK: the layout comment says tour progress is kept in localStorage; the tour code is single-page and keeps none.
  5. Impersonation, trial, renewal and announcement components self-guard and render nothing when not applicable.
- **Async & events:** the bundle wires Echo/Pusher only when keys exist (owned by TIB1/SET); nothing else async.
- **External systems:** Pusher (public key + cluster only, never the secret) - configured under admin real-time settings.
- **Settings:** `user_dashboard_layout`, real-time public config, `credits_per_message`, `ti_pwa_enabled`, platform brand name/favicon/logos, locale direction.
- **Acceptance criteria:**
  - Given `hideHeader` on the Flow Builder in either mode, when the page loads, then no header, rail, announcement or trial bar is rendered.
  - Given real-time is not enabled by the admin, when any page loads, then `pusher-key` meta is empty.
  - Given a session flash `error`, when the next page loads, then a `wa-flash` meta with variant `error` is present and a toast shows.
  - Given a signed-out request rendering an error page, when the layout renders, then it does not throw.
  - Given `navKey=team-inbox`, when the page loads, then the floating inbox bell is not rendered.
- **Source refs:** resources/views/components/layouts/user.blade.php, resources/js/app.js, resources/js/wadesk.js, resources/js/wa-toaster.js, resources/views/partials/js-i18n.blade.php, resources/views/partials/app-font.blade.php.
- **Port notes:** Next.js `(app)/layout.tsx` with server-resolved `ShellConfig` (mode, theme, brand, plan, role) passed to a client `AppShell`. Keep `hideHeader` as a route-level layout option (`fullBleed`). Real-time transport is the target's own websocket gateway, not Pusher.

### WD-ASHELL-013 — Top navigation bar (topbar mode)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-ASHELL-012, RBAC, PLAN, WD-ASHELL-009
- **Summary:** The default customer header: brand logo, workspace switcher, a horizontal menu filtered by workspace-role tier and ordered by the admin's menu layout, and a right cluster of search, theme, language, notifications, admin gear and account menu.
- **Actors & access:** all signed-in users; menu visibility by role tier: `agent/viewer` -> rank 1, `manager` -> 2, `owner/admin` -> 3, no role (platform-only user) -> 3. An item shows when `userRank >= itemRank` (tier `manager`=2, `admin`=3).
- **UX & screens:** `resources/views/components/user/header.blade.php`. Sticky-height 64px header (`max-w-none`). Left: logo (per-theme platform logo; a workspace logo overrides it, WD-ASHELL-025) linking to `/dashboard`; workspace switcher pill (lg+ only, WD-ASHELL-017). Centre: nav (lg+ only, `data-tour="navbar"`, each link `data-tour="nav-<key>"`, active = filled pill), each item with icon and label; items with a plan `feature` show a small gold crown overlay when the plan lacks it (WD-ASHELL-027) but stay clickable. Below lg a hamburger opens a pane with the workspace list + the same items. Right cluster: search icon (md+, opens palette, WD-ASHELL-019), theme button (md+), language switcher (md+), notification bell (WD-ASHELL-018), Admin gear icon (md+, only when `PlatformPermissions::userHasPlatformAccess` = has Spatie role Super Admin, Platform Support or Auditor) -> `/admin`, avatar button (initials over an optional profile photo that removes itself on load error). Server-rendered avatar menu (replaced by the rich JS menu once the bundle binds, WD-ASHELL-019): email, My account (`/account`), Settings (`/settings`), Create workspace (if allowed), Admin (mobile only, isAdmin), Sign out (POST logout).
  **Catalogue** (key, tier, feature, promo): dashboard (manager); team-inbox "Unified Inbox" (admin); metaads (admin, access_ctwa, promo); wa-campaigns (admin, campaign); flows (admin, autoflow); templates (manager, template); devices "Channels" (admin); promo-only extras, hidden unless placed in the bar by the admin: broadcasts (admin), contacts (manager), crm (admin, access_sales_pipeline), deals (admin, access_sales_pipeline), ai-crm (admin, access_ai_agents), companies, tasks, projects, proposals, estimates, calendar (admin, access_sales_pipeline), payments (admin, auto_invoice), chat "Live Chat" (manager), analytics (manager), auto-reply (admin), scheduled (admin), message-history "History" (manager), ai-assistants (admin, access_ai_agents), ai-training (admin, access_ai_training), wa-links (manager), chatbot-widgets (admin, access_chatbot_widgets), webhooks (admin, access_outbound_webhooks), integrations (admin), warmer (admin), call-logs (admin), support (manager); and `more` (admin, always last resort).
- **Endpoints:** none (links). Search/notification/theme endpoints belong to WD-ASHELL-018/019/024.
- **Data:** `system_settings.user_nav_order` (WD-ASHELL-009), workspace role, plan feature checks.
- **Rules & edge cases:**
  1. Ordering: new format `{bar:[...]}` = ONLY those keys, in that order, `more` appended if absent; legacy flat array = reorder of the non-promo default list; default = non-promo items in catalogue order (Dashboard, Unified Inbox, Campaigns, Flows, Templates, Channels, More).
  2. QUIRK: `team-inbox`, `more` and every non-dashboard/templates item have tier `admin`/`manager`, so an `agent` or `viewer` gets an EMPTY menu (rank 1 never satisfies tier 2 or 3) even though the code comment claims agents see Team Inbox. In practice agents live on `/team-inbox` via redirects (WD-ASHELL-002) with no top menu. A manager also does not see Unified Inbox or More (admin tier). Port must decide the intended per-role menu.
  3. `requires_provider` engine gate is coded but no item uses it, and `default_send_method` is read but unused.
  4. The Admin gear uses platform roles (Support/Auditor pass) while the admin route gate requires Super Admin/Admin (WD-ASHELL-002); the mobile avatar menu "Admin" link uses `isAdmin()`.
  5. The header includes its own inline JS for workspace/user/mobile menus and the notification dropdown; `wadesk.js` later removes the server user pane and rebinds the avatar.
- **Async & events:** notification poll every 60 s (WD-ASHELL-018).
- **External systems:** none.
- **Settings:** `user_nav_order`, `user_dashboard_layout` (must be `topbar`).
- **Acceptance criteria:**
  - Given a manager, when the header renders with the default layout, then Dashboard and Templates appear and Unified Inbox, Campaigns, Flows, Channels and More do not.
  - Given an owner and `user_nav_order={"bar":["contacts","dashboard"]}`, when the header renders, then the bar reads Contacts, Dashboard, More.
  - Given a plan without `autoflow`, when an owner views the bar, then Flows shows a crown but still links to `/flows`.
  - Given a viewport under 1024px, when the header renders, then the menu collapses into the hamburger pane and the workspace switcher lives inside it.
  - Given a user with the Auditor role but no admin role, when the header renders, then the gear shows but `/admin` returns 403.
- **Source refs:** resources/views/components/user/header.blade.php, app/Models/User.php, app/Support/PlatformPermissions.php.
- **Port notes:** one typed nav catalogue shared by header, rail, More, quick-access, and menu editor; add `minRole`, `featureKey`, `channelGate`, `defaultZone`. Fix the agent/manager gaps deliberately.

### WD-ASHELL-014 — Sidebar rail navigation catalogue and filters

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-ASHELL-012, PLAN
- **Summary:** In sidebar mode the whole product catalogue is listed in 11 collapsible groups. Items are filtered by role tier and by whether a channel/add-on is available; plan-gated items are kept but marked locked.
- **Actors & access:** signed-in users; same tier ranks as WD-ASHELL-013 (`UserNav::userRank`). Plan gate per item via `PlanLimitGuard::hasFeature(currentWorkspace, feature)` (platform admins always true).
- **UX & screens:** data source `app/Support/UserNav.php::groups()`; rendered by the rail (WD-ASHELL-015). Groups and items (label, key, href, tier, feature key, availability flag):
  - **Overview:** Dashboard `/dashboard` (manager), Analytics `/analytics` (manager), Notifications `/notifications` (manager).
  - **Inbox & Chat:** Unified Inbox `/team-inbox` (admin), Quick Chat `/chat` (manager), Call Logs `/call-logs` (admin), Team Chat `/team-chat` (manager), Team Members `/team-inbox/members` (admin).
  - **Audience:** Contacts (manager), Attributes (manager), Contact Groups `/contact-groups` (manager), Lead Finder (manager; access_lead_finder), Deals (admin; access_sales_pipeline).
  - **Campaigns:** Campaigns `/wa-campaigns` (admin), Broadcasts (admin), Scheduled (admin), Templates (manager; template), WhatsApp Forms `/wa-forms` (admin; needs a connected WABA provider), Meta Groups `/waba-groups` (admin; WABA), History `/message-history` (manager).
  - **Automation:** Flows (admin; autoflow), Flow Analytics `/flows/analytics` (admin; autoflow), AI Assistants (admin; access_ai_agents), Auto-reply (admin), Appointments (admin; access_appointment_booking), AI Training (admin; access_ai_training), AI Usage `/ai-usage` (manager; access_ai_agents), Chat Widget `/chatbot-widgets` (admin; access_chatbot_widgets), Warmer (admin).
  - **Channels:** Channels `/devices` (admin), Meta Ads (admin; access_ctwa), All Posts `/social/posts` and Social Calendar `/social/calendar` (admin; shown if Instagram OR Facebook OR TikTok is available), Instagram Posts `/instagram/posts` (admin; needs instagram_enabled or a connected Instaflow), Facebook Posts / Messenger Setup / Messenger Broadcasts (admin; facebook_enabled; broadcasts also access_facebook), TikTok + TikTok Posts (tiktok_enabled), Telegram (telegram_enabled, access_telegram), SMS (sms_enabled), LINE (line_enabled, access_line), Viber (viber_enabled, access_viber), WeChat (wechat_enabled, access_wechat), Email (points to `/devices`; email_enabled, access_email), WA Links (manager).
  - **Sales & CRM:** CRM Dashboard `/crm` (admin; access_sales_pipeline).
  - **Store:** Store `/store` (admin), Catalog `/catalog` (admin; access_wa_storefront).
  - **Developer:** Integrations (admin), Google Account (admin), REST API `/developers` (admin), Webhooks (admin; access_outbound_webhooks).
  - **Help:** Support (manager), Guidebook (manager), Activity Log `/activity-log` (admin).
- **Endpoints:** none (links). Each target belongs to its own domain.
- **Data:** system settings `facebook_enabled`, `tiktok_enabled`, `telegram_enabled`, `sms_enabled`, `line_enabled`, `wechat_enabled`, `viber_enabled`, `email_enabled`, `instagram_enabled` (all default false), `InstaflowClient::fromSettings()->isConnected()`, `WorkspaceEngine::validDeviceIdsForEngine(ws,'waba')` (any connected `provider=waba` row).
- **Rules & edge cases:**
  1. Groups with no visible items are dropped. Tier filter removes items above the user's rank, availability flags remove unavailable channels; then plan features are checked and a failing item gets `locked=true` (NOT removed: hiding a page a client used to see reads as "the page disappeared").
  2. Instagram availability check swallows exceptions and falls back to the `instagram_enabled` setting.
  3. QUIRK: same tier bug as topbar: nothing has tier `agent`, so an `agent/viewer` gets no groups at all.
  4. `/more` does not exist in sidebar mode as a nav item, but the route still works and is linked from Settings breadcrumb, the quick-access drawer ("All apps") and quick-access catalog.
  5. The sidebar has no entry for Companies, Tasks, Projects, Proposals, Estimates, Calendar, Payments, AI CRM, Account, Affiliate; they must be reached from the CRM hub, the search palette, or user menu.
  6. `analytics` has no `feature` tag here although its route requires `access_analytics`; a plan without it opens the page and gets the paywall sheet instead of a locked row.
  7. `menu-order` settings (WD-ASHELL-009) do not affect sidebar mode.
  8. The href for `/instagram/posts` is an extension route (registered by the Instagram extension, not in the core route table).
- **Async & events:** none.
- **External systems:** Instaflow connection probe (ADD/IG).
- **Settings:** channel enable flags above; `user_dashboard_layout=sidebar`.
- **Acceptance criteria:**
  - Given a manager and no channels enabled, when the rail data is built, then Dashboard, Analytics, Notifications, Quick Chat, Team Chat, Contacts, Attributes, Contact Groups, Lead Finder, Templates, History, AI Usage, WA Links, Support and Guidebook are present and every admin-tier item is absent.
  - Given `telegram_enabled=false`, when the rail data is built, then Telegram is absent for an owner; when true and the plan lacks `access_telegram`, then it is present with `locked=true`.
  - Given no connected WABA provider, when the rail data is built, then WhatsApp Forms and Meta Groups are absent.
  - Given a platform admin, when the rail data is built, then no item is locked.
- **Source refs:** app/Support/UserNav.php, app/Services/WorkspaceEngine.php (`validDeviceIdsForEngine`), app/Services/PlanLimitGuard.php (`hasFeature`), app/Services/Instaflow/InstaflowClient.php, config/plan_gates.php.
- **Port notes:** implement as a server function returning `{groups:[{label,items:[{key,label,href,icon,locked}]}]}` fed by the shared catalogue; channel availability from the channel domains' enabled state per tenant (WaDesk uses global switches).

### WD-ASHELL-015 — Sidebar rail chrome and behaviour

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-ASHELL-014
- **Summary:** The visual and interactive shell of the sidebar: brand block, workspace card, collapsible sections, scroll memory, active highlighting, locked-item handling, wallet card and mobile drawer.
- **Actors & access:** signed-in users in sidebar mode.
- **UX & screens:** `resources/views/components/user/sidebar-rail.blade.php` inside `aside#user-rail` (260px, `md:static`, off-canvas on phones with backdrop `#user-rail-backdrop`, close X button `data-user-rail-close`, hamburger `data-user-rail-toggle` lives in the top strip). Brand: platform logo for the active theme or a green mark plus brand name and the caption "console". Workspace card: 2-letter initials tile, workspace name, plan label (or platform brand and "Free" if none). Nav: each group has a caption button (`data-rail-toggle`, chevron rotating -90 degrees when collapsed, max-height animation) and items as `.rail-link`; active item has the accent tint and a 3px accent bar. Locked item: muted, lock icon at the end, screen-reader "Upgrade required", tooltip "Not included in your plan - tap to upgrade", links to `/account/plans` instead of its own route. Wallet card at the bottom: "Wallet", plan chip, formatted wallet money (`wallet_credits * minorPerCredit / 100` via `FormatSettings::display`) and a "Top up" button to `/account?tab=wallet`.
- **Endpoints:** none.
- **Data:** `users.wallet_credits`, `MessageCreditRate::minorPerCredit()`, workspace plan.
- **Rules & edge cases:**
  1. Active detection: `navKey` equals item key OR the current path equals the item's path or starts with `<path>/`. This fallback exists because many pages set `nav-key="more"`.
  2. A locked item is never highlighted.
  3. Restored collapsed state is applied with transitions disabled to avoid an animated flash, then transitions are re-enabled next frame.
  4. Colour handling: see WD-ASHELL-011. Custom text colour derives an alpha ladder; otherwise luminance decides light/dark.
  5. On a white-label tenant domain (`$isTenantDomain`) the workspace switcher menu is not rendered (locked to one workspace).
  6. Rail scroll persistence uses `sessionStorage`; collapsed groups use `localStorage` (per browser, not per user or workspace).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `user_sidebar_color`, `user_sidebar_text_color`, `user_sidebar_accent_color`.
- **Acceptance criteria:**
  - Given the user collapses "Campaigns" then navigates to Contacts, when the next page loads, then Campaigns stays collapsed and the Audience group is expanded.
  - Given the current path `/flows/analytics`, when the rail renders, then both the Flows and Flow Analytics items are candidates and only the ones matching by path or key are active.
  - Given a locked item, when clicked, then the browser goes to `/account/plans`.
  - Given a phone viewport, when the hamburger is tapped, then the rail slides in, the backdrop shows and body scroll is locked.
- **Source refs:** resources/views/components/user/sidebar-rail.blade.php, resources/views/components/layouts/user.blade.php (inline script), resources/css/wadesk.css.
- **Port notes:** build the rail as a client component with `useCollapsedGroups()` (localStorage) and CSS variables for the colour tokens. Prefer route-prefix matching over `navKey`.

### WD-ASHELL-016 — Sidebar-mode top strip (jump search, greeting, clock)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-ASHELL-014
- **Summary:** In sidebar mode a slim 64px strip replaces the header: breadcrumb, a "search or jump to" box over exactly the pages this user can reach, a time-aware greeting with live clock, and the usual theme, language, bell and account controls.
- **Actors & access:** signed-in users in sidebar mode.
- **UX & screens:** `resources/views/components/user/topstrip.blade.php` (height exactly 64px so full-height pages can use `calc(100vh - 64px)`). Breadcrumb: brand name > page title. Jump box `#ts-search` (md+): index = every visible rail item (label + group) plus Account (`/account`), Settings (`/settings`), Wallet (`/account?tab=wallet`), Notifications (`/notifications`) under group "Account"; matching = case-insensitive substring on label + group, max 8 results; Arrow keys move, Enter opens, Esc closes, Ctrl/Cmd+K focuses the box. Greeting (lg+): "Burning the midnight oil" (before 05:00), Good morning (<12), afternoon (<17), evening (<21), Good night (else), suffixed with the first name; below it the viewer's local date + time (locale formatted), refreshed every 20 s. Right: language switcher, theme button, bell with dropdown (same feed as WD-ASHELL-018), user menu (initials, first 16 chars of name, "Admin" or "Member"; items Account, Settings, Wallet, Admin dashboard when isAdmin, Log out via `#logoutForm`).
- **Endpoints:** consumes `user.notifications.recent|read-all|destroy-all`.
- **Data:** the nav index; no writes.
- **Rules & edge cases:**
  1. The jump index uses each item's own `href` even for plan-locked items (unlike the rail, which points locked items at the plans page).
  2. QUIRK: Ctrl/Cmd+K is bound both here (focus the strip box) and globally in `wadesk.js` (open the full palette, WD-ASHELL-019), so both fire.
  3. The bell here polls every 60 s without a visibility check and lacks the per-item mark-read handler the header version has.
  4. Guard: a null user is tolerated (`?->`); listeners are attached once (`window.__tsStripWired`).
  5. Greeting words are static strings routed through translations; the first name is `explode(' ')[0]` of `users.name`.
- **Async & events:** 60 s notification poll, 20 s clock tick.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the user types "bro", when the input changes, then results include Broadcasts (group Campaigns) with the first match highlighted and Enter opens it.
  - Given it is 09:30 local time and the user is "Priya Nair", when the strip renders, then the greeting reads good morning with "Priya".
  - Given a plan-locked item matching the query, when chosen, then the browser navigates to the item's own route (where the paywall sheet appears).
- **Source refs:** resources/views/components/user/topstrip.blade.php, app/Support/UserNav.php.
- **Port notes:** share one `useJumpIndex(navGroups)` hook with the command palette so the two searches merge; drop the double-binding.

### WD-ASHELL-017 — Workspace switcher (header, rail, mobile)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WSP, WD-ASHELL-013, WD-ASHELL-015
- **Summary:** Users who belong to several workspaces switch the active workspace from a pill in the header (or the workspace card in the rail, or the mobile menu), and can create another workspace when their plan and role allow.
- **Actors & access:** any signed-in user; "Create new workspace" only when `User::canCreateWorkspace()` AND the user is workspace owner/admin (or platform admin). In the rail the create link is gated by `canCreateWorkspace()` only. Membership is verified server-side on switch.
- **UX & screens:** header pill (lg+): 2-letter initials disc coloured by `workspace_brand_color` (a stored `#075E54` default counts as "not chosen" and falls back to the live theme token), label = workspace name with a leading possessive owner prefix stripped ("Ana's workspace" -> "Workspace"; regex `^.+?['\x{2019}]s\s+`), tooltip = full name + "Switch workspace"; hidden below lg and moved into the hamburger pane there. Dropdown "Your workspaces": list ordered by `last_active_at` desc (max height ~260px, scrolls) each a POST form to `workspaces/{id}/switch` showing initials, name, slug, tick on the active one; footer link "Create new workspace" (`/workspaces/create`). Rail version is the same list inside the workspace card. On a white-label tenant domain (`isTenantDomain`) the list and create link are omitted.
- **Endpoints:**

| Method + uri                  | Route name          | Controller@action              | Middleware | Request fields | Response                                                   |
| ----------------------------- | ------------------- | ------------------------------ | ---------- | -------------- | ---------------------------------------------------------- |
| POST `workspaces/{id}/switch` | `workspaces.switch` | AuthController@switchWorkspace | auth       | path id        | redirect back; flash status "Switched to <name>." or error |

(Route is owned by WSP/AUTH; listed for the contract.)

- **Data:** `users.current_workspace_id` (written), `workspaces.last_active_at` (touched), `workspace_user` membership, audit `workspace.entered` (meta `from` = previous id; skipped when re-entering the same workspace).
- **Rules & edge cases:**
  1. Non-member id -> flash error "You are not a member of that workspace."
  2. Tenant-domain lock returns error "Workspace switching is disabled on this domain." and the middleware would override it anyway.
  3. `canCreateWorkspace`: platform admin always true; no workspace yet true; reads `workspaces_per_owner_limit` from the current workspace's effective plan limit, `null/0/negative` = unlimited, otherwise owned-workspace count must be below the limit; any lookup error returns true.
  4. The create routes are additionally protected by `workspace.role:admin`; agents/viewers/managers never see the link.
  5. Impersonation: `current_workspace_id` is swapped in memory only (WD-ASHELL-030), so the pill shows the impersonated workspace but the admin's own row is not changed.
- **Async & events:** audit event; no push.
- **External systems:** none.
- **Settings:** `workspaces_per_owner_limit` (plan).
- **Acceptance criteria:**
  - Given a user in three workspaces, when they choose another in the dropdown, then the page reloads scoped to it and the flash says "Switched to <name>."
  - Given a user at their plan's workspace cap, when the dropdown renders, then "Create new workspace" is hidden.
  - Given a manager, when the dropdown renders, then no create link is shown.
  - Given a tenant-domain host, when the header renders, then there is no dropdown and switching is rejected.
- **Source refs:** resources/views/components/user/header.blade.php, sidebar-rail.blade.php, app/Http/Controllers/AuthController.php (`switchWorkspace`), app/Models/User.php (`switchWorkspace`, `canCreateWorkspace`), app/Support/fc_helpers.php (`workspace_brand_color`).
- **Port notes:** target already has tenancy; switching should re-issue the session's active org claim. Consider showing the cap reason instead of hiding the link.

### WD-ASHELL-018 — In-shell notification bell dropdown

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** NOTIF
- **Summary:** A bell with unread badge in every header opens a dropdown of the latest notifications with mark-all-read and clear-all, and refreshes in the background.
- **Actors & access:** signed-in users (customer header, sidebar top strip) and platform admins (admin header, WD-ASHELL-006, separate feed).
- **UX & screens:** bell button `#notif-toggle`, badge `#notif-badge` (`99+` cap, hidden at 0); pane `#notif-pane` (360px anchored dropdown on desktop, pinned to viewport edges on mobile). Header: "Inbox / Notifications", "Mark all read". List max height 420px; row = unread dot, title (severity `error|critical` coral, `warning` amber), message (2-line clamp), relative time; click opens `action_url` or `/notifications`. Empty copy "No notifications yet."; loading copy "Loading...". Footer: "Clear all" (coral) and "View all". Client-side HTML escaping is applied to every field.
- **Endpoints:** owned by NOTIF, consumed here. GET `notifications/recent` (`{items[], unread}`), POST `notifications/read-all`, DELETE `notifications` (`user.notifications.destroy-all`), POST `notifications/{id}/read` (single mark-read on click; keepalive request; optimistic badge decrement; header only). Legacy page GET `notifications-page` (`user.notifications.legacy`, `UserPagesController@notifications`) renders `user/notifications/index` and is owned by NOTIF.
- **Data:** none locally.
- **Rules & edge cases:**
  1. Load on open and every 60 s (header pauses when the tab is hidden; the top strip variant does not).
  2. Failures are silent; the pane stops propagation so inside clicks do not close it.
  3. Badge decrement by one only when the clicked row was unread.
- **Async & events:** 60 s polling; realtime push is not used for this bell.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 3 unread, when the header loads, then the badge shows 3.
  - Given the pane open, when the user clicks an unread row, then a read request is sent and the badge shows 2 after navigation.
  - Given "Clear all", when confirmed by the request, then the list reloads empty with the empty-state copy.
- **Source refs:** resources/views/components/user/header.blade.php (inline script), topstrip.blade.php, admin/header-right.blade.php.
- **Port notes:** replace polling with the websocket notification channel where available; keep a pull fallback.

### WD-ASHELL-019 — Global search palette and profile menu

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-ASHELL-012
- **Summary:** A Ctrl/Cmd+K palette that jumps to any page from a static index, and the rich profile dropdown that replaces the server-rendered avatar menu once the bundle loads.
- **Actors & access:** every layout that loads the app bundle (customer and admin). The index is NOT filtered by role, plan or enabled channels.
- **UX & screens:** built in `resources/js/wadesk.js` (`injectOverlays`). Search modal `#wa-search-modal` (blurred backdrop, 640px card): input "Search pages, contacts, templates, settings...", results list, footer hints (up/down navigate, Enter open, Cmd K toggle), Esc to close, click outside closes. With an empty query it shows the first 8 entries; with a query it filters title, description and hidden keywords (`kw`), max 12; tag chips `page`, `account`, `plan`, `help`, `system`; empty state "No results for ...". Index (56 hard-coded entries): dashboard, chat, team inbox, sales pipeline, team chat, broadcasts, WA campaigns, scheduled, message history, templates, auto reply, flows, flow builder, AI assistants, AI training, call logs, chatbot widgets, WhatsApp forms, WhatsApp links, contacts, attributes, analytics, Meta Ads (+analytics), catalog, store (+orders, +products), appointments, devices, connect, integrations, Shopify, WooCommerce, HubSpot, Google account, webhooks, all features (`/more`), account tabs (profile, wallet, orders, affiliate, support, password), pricing and plans, notifications, settings, guidebook, support, admin console entries (Admin Console, Analytics, Support, Security, Audit Log, Settings) and a Logout entry that submits `#logoutForm` (falls back to `/login`). Profile menu `#wa-profile-menu` (260px card): avatar initials, name, email, chip "<plan> plan - <role label>"; rows Admin dashboard (amber, only when `WADESK_USER.isAdmin`), Profile (`/account?tab=profile`), Wallet (with formatted balance), Order history (`/account?tab=orders`), Settings, Pricing & plans (`/account/plans`), Help & support (`/account?tab=support`), Log out; footer "<app name> - v<version>" (from `config('version.version')`).
- **Endpoints:** none (client-only; the logout form posts to `logout`).
- **Data:** `window.WADESK_USER`, `window.WADESK_BRAND`.
- **Rules & edge cases:**
  1. Every href is passed through `wurl()` which prefixes the deploy sub-folder (`app-base`) unless already prefixed or absolute.
  2. Ctrl/Cmd+K opens the modal on every page (and Esc closes search + profile); this coexists with the top strip's own binding (WD-ASHELL-016) and the admin injected search box (decorative).
  3. The server pane `[data-user-pane]` is removed when the JS binds the avatar (found by `header [data-user-toggle]`), so the rich menu wins; without JS the fallback pane still works.
  4. QUIRK: the palette lists Admin and paid-plan pages to everyone, so unauthorised users get a 403 or paywall on select; there is no per-workspace data (contacts, templates) search despite the placeholder text.
  5. User name/email are interpolated into innerHTML without escaping in the profile menu (input comes from the user's own profile; port must escape).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given any page, when the user presses Ctrl+K, then the palette opens with the input focused and 8 default entries.
  - Given the query "roas", when typed, then "Meta Ads analytics" is listed (matched by keyword).
  - Given a platform admin, when the profile menu opens, then the amber Admin dashboard row is first.
  - Given the app is served under `/public`, when a result is chosen, then the URL includes the `/public` prefix.
- **Source refs:** resources/js/wadesk.js, resources/views/components/user/header.blade.php, resources/js/app.js.
- **Port notes:** the target already has global search elsewhere; here build a client command palette fed by the nav catalogue (role-filtered) plus optional server search endpoints for entities.

### WD-ASHELL-020 — More hub page (`/more`) with live counters

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** WD-ASHELL-013
- **Summary:** The overflow page reachable from the top bar: a dashboard of cards for every tool not in the header, each with a live one-line stat, plus workspace health, plan/wallet, tips and recent activity.
- **Actors & access:** any signed-in user (route is `auth` only; no workspace-role middleware). Data is scoped to the current workspace. Plan gating is visual only (crowns).
- **UX & screens:** `resources/views/user/more/index.blade.php` (nav-key `more`, page `user-more-index`) and `resources/js/charts/user-more-index.js`. Header "More features" with a Developers / API button (`user.developers`) and a static "Sorted by usage" chip (QUIRK: the grid is NOT actually sorted by usage). Stats strip (4 cards): Active rules (live keyword replies + published-and-active flows + active webhooks; "+N this week"), Queued (scheduled messages with status `scheduled|running`, next run relative time or "no upcoming runs"), Connected (active/total devices for the workspace's engine, health `healthy|partial|offline|no devices`), Notifications unread. "Navigation" strip: cards for header items demoted to More (Dashboard, Campaigns, Flows, Templates only; Meta Ads always has its own card) when the saved bar (`user_nav_order.bar`, else the default bar `dashboard, team-inbox, wa-campaigns, flows, templates, devices, more`) does not contain them. "All tools" grid with client-side tabs All / Automation / Data / Help (category derived from the first URL path segment via a static map in JS; unmapped pages such as account, pricing, chat, team-inbox appear only under All). Cards (each an anchor with icon, title, description, footer stat), in source order: Meta Ads, Instagram Posts (if Instagram is available), Facebook Posts and Messenger Setup (facebook_enabled), SMS, LINE, WeChat, Viber, TikTok and TikTok Posts (their enable flags), AI CRM guide (`/crm/guide`), Quick Send (`/chat`), Account, Pricing and plans (static blurb naming Starter/Growth/Pro/Enterprise plus a live current-plan subtitle), Analytics, Attributes, Contacts, Broadcasts, Auto Reply, WhatsApp Warmer, Scheduled Messages, Message History, Notifications, Integrations, Google account, Appointments (`/appointments/booking-types`), AI Call Assistant, Call Logs, Forms (WABA only), WhatsApp Link Generator, Chatbot Widget, AI Training, AI Usage, Flow Analytics, Lead Finder, Webhooks, Support, Activity Log, Guidebook, Channels (`/devices`), Team members, Affiliate history; many carry a non-clickable crown for plan-gated features (`<x-plan-crown link=false>`). QUIRK: there is no card for Telegram, Messenger Broadcasts, Store, Catalog, Deals, CRM dashboard, Team Chat or Email, so those are only reachable from the header (if promoted), the quick-access catalog, the palette or the CRM guide. Right rail: plan card (plan name + period, seats, messages this month, no monthly cap shown), wallet card with Top up link, rotating tip card (5 tips, every 7 s, dot pager, tips link to templates, flow builder, palette, scheduled create, wallet), static "what's new" list, best-practice tips, recent activity (5 latest audit rows), and the shortcuts strip (WD-ASHELL-021).
- **Endpoints:**

| Method + uri | Route name  | Controller@action        | Middleware | Request fields | Response |
| ------------ | ----------- | ------------------------ | ---------- | -------------- | -------- |
| GET `more`   | `user.more` | UserPagesController@more | auth       | none           | HTML     |

- **Data:** read-only aggregates from `keyword_replies` (via `KeywordReply::forListing` so the card matches the Auto-reply page), `flows` (`is_published` and `is_active`), `webhooks` (`status=1`), `scheduled_messages`, engine-aware devices (`Device` with `active=1` for Baileys; `wa_provider_configs` with status connected for WABA/Twilio via `WorkspaceEngine::for`), `contacts`, `contact_groups`, `tags`, `broadcasts` (status `pending|processing|scheduled`) and delivered percent over last-30-day outgoing `messages`, `auto_reply_lookups` match rate (last 30 days), `messages` totals, `notifications` (`Notification::forCurrentWorkspace()` with `status=true`), webhook deliveries 30-day 2xx uptime, plan (`billingPackage()->pname`, `plan_unit`), seats (`workspace_user` count), team-inbox counts (open, unassigned, agents online = members with `users.inbox_last_seen_at` within 5 minutes), integrations connected (Hubspot/Shopify/Woocommerce rows with `status=active`; available is hard-coded 3), affiliate (`referrals` count and `credits_awarded` sum), support tickets (total and not `resolved`), analytics 7-day outbound `inbox_messages`, `attributes` count, `audit_logs` 24h count and latest 5, published `guidebook_articles`, open deals (`Deal::forCurrentWorkspace()->open()`).
- **Rules & edge cases:**
  1. Recent activity is workspace-scoped only (an earlier OR-with-actor query leaked other workspaces' events). Label mapping: explicit map for `auth.login/logout/failed`, `workspace.entered`, `conversation.assigned|resolved|replied`, `note.added`, `team.created`; otherwise "<Category> <rest>" title-cased; two-letter badge per category (AU, IN, NT, TM, BC, WH, WS, default dots) with per-category colours.
  2. `humanShortNumber`: <1000 as is, <10k one decimal `k`, <1M rounded `k`, <10M one decimal `M`, else rounded `M`.
  3. Every card shown is gated by the same availability flags as the rail (WD-ASHELL-014). The rail's WABA forms rule also hides Forms/Meta Groups here.
  4. Unread notifications card previously counted legacy NULL-workspace rows (77k in every workspace); now scoped via `forCurrentWorkspace`.
  5. QUIRK: "Active rules" adds keyword replies, flows and webhooks and calls the sum "across all tools"; the "+N this week" counts created rows, not activated ones.
  6. QUIRK: the /more stat queries are ~40 uncached queries per page view.
- **Async & events:** none (tips rotate client-side).
- **External systems:** none.
- **Settings:** `user_nav_order`, channel flags, `facebook_enabled`, `sms_enabled`, `line_enabled`, `wechat_enabled`, `viber_enabled`, `tiktok_enabled`, `instagram_enabled`.
- **Acceptance criteria:**
  - Given a workspace with 2 live keyword replies, 1 published+active flow and 1 active webhook, when the page loads, then Active rules shows 4.
  - Given the admin demoted Templates from the bar, when a manager opens `/more`, then a Templates card appears in the "Navigation" strip.
  - Given the user clicks the "Data" tab, when the tab activates, then only cards whose path maps to `data` (analytics, contacts, attributes, message-history, activity-log, devices, affiliate-history, notifications) remain visible.
  - Given a workspace with no devices, when the page loads, then the Connected card reads `0 / 0` with health "no devices".
- **Source refs:** app/Http/Controllers/UserPagesController.php (`more`, lines 1962-2330), resources/views/user/more/index.blade.php, resources/js/charts/user-more-index.js, app/Services/WorkspaceEngine.php, app/Models/KeywordReply.php.
- **Port notes:** decompose into a `GET /api/workspace/overview-stats` endpoint returning the counters (each owned by its domain via a stats provider interface) so the shell does not query 30 tables. Keep the card catalogue in the shared nav data.

### WD-ASHELL-021 — More page shortcut strip customizer (browser-local)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-ASHELL-020
- **Summary:** A "Shortcuts" strip at the bottom of the More page shows up to a handful of quick actions that the user can add, remove, reorder and reset; it is stored in the browser only.
- **Actors & access:** any signed-in user; no server call.
- **UX & screens:** strip `#more-shortcuts-section` with grid `#more-shortcuts-grid` and a Customise button; modal `#more-shortcuts-modal` with a current-cards list (up/down/remove per row), preset picker + Add, custom-shortcut form (title max 40, subtitle max 64, URL max 160, icon select link/plus/clock/inbox/users/phone/template), Reset defaults, Cancel, Save. Empty state "No shortcuts selected" with a Customise hint. Default 5: New auto reply (`/auto-reply/create`), Schedule send (`/scheduled/create`), Test webhook (`/webhooks`), Export history (`/message-history`), Contact support (`/support`). Preset catalogue adds: New broadcast (`/broadcasts/create`), Open contacts, Pair device (`/devices`), Team inbox, Create flow (`/flows`), New template (`/templates/create`).
- **Endpoints:** none.
- **Data:** `localStorage` key `wadesk:more-page-shortcuts:v1:ws<workspaceId>` (JSON array of `{id,title,subtitle,href,icon,bg,fg,custom}`); invalid JSON or non-array -> defaults; entries revalidated on load.
- **Rules & edge cases:**
  1. Presets cannot be added twice; a custom entry needs title and URL.
  2. `normaliseHref`: empty -> `#`, `//x` collapsed to `/x`, accepts `http(s):`, `mailto:`, `tel:`, `/`, `#`; anything else is treated as an in-app path and prefixed with `/`. Custom entries whose href normalises to `#` are dropped on load.
  3. Storage failure shows an error toast but the UI still updates for the session.
  4. QUIRK: preset subtitles are static marketing copy that can be untrue ("Avg reply 2h 14m", "Fire a sample payload" on a link that only opens the Webhooks list).
  5. This is a different mechanism from server-stored Quick access (WD-ASHELL-022); users can have both.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a fresh browser, when `/more` loads, then the strip shows the 5 default shortcuts.
  - Given the user adds a custom link "Reports" to `reports`, when saved and reloaded, then the shortcut points to `/reports`.
  - Given a different workspace, when the user switches, then the strip reads a separate storage key.
- **Source refs:** resources/js/charts/user-more-index.js, resources/views/user/more/index.blade.php.
- **Port notes:** simple client feature; if promoting to server-side, merge with Quick access into one per-user `nav_shortcuts` list.

### WD-ASHELL-022 — Quick access tiles, edge drawer and editor

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-ASHELL-012
- **Summary:** Each user pins up to 10 shortcuts (catalog pages or custom links). They show as a tile grid on the dashboard and as a draggable edge drawer available on every page, and are edited in one shared modal.
- **Actors & access:** any signed-in user, per-user (not per-workspace). Route is `auth` only.
- **UX & screens:** dashboard section `data-tour="quick-access"` (grid of up to 10 tiles: 3/5/10 columns responsive, each with icon, label, hover card with description, Edit button with `data-qa-open`); drawer `components/user/quick-access-drawer.blade.php` (grip `#qad-handle` on the right edge, draggable vertically, default 120px from top, clamped 8..(height-60), position stored in `localStorage['qadHandleTop']`; click toggles the sliding panel `#qad-panel` with backdrop; contents = pinned tiles, a divider, fixed Dashboard, "All apps" (`/more`), Edit shortcuts and Close; hovering an icon shows a dark tooltip card on `<body>` positioned to the left of the icon (flips right if no room), hidden on scroll/resize/Esc; Esc closes); editor modal `components/user/quick-access-modal.blade.php` (`#qa-modal`): checkbox grid of the 20-page catalog, "Custom links" rows (label + URL + delete), counter "N / 10 pinned", Cancel and "Save shortcuts". Drawer is hidden while the connect-device sheet is open.
  Catalog keys (label -> path): inbox Unified Inbox `/team-inbox`, contacts, campaigns `/wa-campaigns`, broadcasts, templates, flows, scheduled, catalog, store, deals "Sales Pipeline", analytics, auto-reply, devices, chatbots "Chat Widgets" `/chatbot-widgets`, ai "AI Assistants", appointments, webhooks, history "Message Log" `/message-history`, account `/account`, more "More apps" `/more`. Defaults (never customised): inbox, contacts, campaigns, broadcasts, templates, flows, scheduled, catalog, deals, analytics.
- **Endpoints:**

| Method + uri        | Route name            | Controller@action            | Middleware | Request fields                          | Response                                                   |
| ------------------- | --------------------- | ---------------------------- | ---------- | --------------------------------------- | ---------------------------------------------------------- |
| POST `quick-access` | `quick-access.update` | QuickAccessController@update | auth       | `items[]` each `{key}` or `{label,url}` | JSON `{ok:true, tiles:[{key,label,desc,url,icon,custom}]}` |

- **Data:** `users.quick_access` (JSON, nullable; added by migration 2026_06_24_180000): list of `{key}` and `{label,url}` entries.
- **Rules & edge cases:**
  1. `items` not an array -> treated as `[]`. Sanitize: catalog keys accepted, custom entries need non-empty label and url, label cut to 40 chars, url trimmed and cut to 255, URL must start with `/` or match `^https?://` (case-insensitive); other schemes (javascript:) are dropped. Result capped at 10 entries in order.
  2. QUIRK: `//evil.example` starts with `/` and is accepted as a custom link (protocol-relative external URL). Port must reject.
  3. QUIRK: saving an empty selection stores `[]`, and `forUser` treats empty as "not customised" and returns the 10 defaults again; users cannot end with zero shortcuts, and the dashboard "Add quick-access shortcuts" empty state is effectively unreachable.
  4. Rendering resolves `saved` entries: unknown keys and malformed rows are skipped; capped at 10.
  5. The client also blocks pinning beyond 10 (toast "You can pin up to 10 shortcuts.") and reloads the page on success (toast "Quick access updated.").
  6. Catalog items are not plan- or role-filtered; a pinned link may open a paywall or a redirect.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a new user, when the dashboard loads, then 10 default tiles show and the edge drawer lists them.
  - Given the user pins Webhooks and a custom link `https://example.com/kb` labelled "KB" and saves, when the page reloads, then both tiles show and the response tiles include `custom:true` for KB.
  - Given a POST with `{label:"x",url:"javascript:alert(1)"}`, when sanitized, then the entry is dropped.
  - Given the user drags the grip to y=300, when they reload, then the grip is at 300px.
- **Source refs:** app/Support/QuickAccess.php, app/Http/Controllers/QuickAccessController.php, resources/views/components/user/quick-access-drawer.blade.php, quick-access-modal.blade.php, resources/views/user/dashboard/index.blade.php (section), resources/js/app.js (`initQuickAccessDrawer`, `initQuickAccessModal`), database/migrations/2026_06_24_180000_add_quick_access_to_users.php.
- **Port notes:** `users.quick_access jsonb` or a `user_shortcuts` table with position; validate URLs with a strict allowlist; expose `GET/PUT /me/shortcuts`; respect role/plan when rendering.

### WD-ASHELL-023 — Guided product tour

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-ASHELL-013, DASH
- **Summary:** First-time users get a short spotlight tour of the header and dashboard cards the first time they open `/dashboard`; finishing or skipping records that it was seen.
- **Actors & access:** signed-in users who can open the dashboard (manager and above). Agents/viewers never reach `/dashboard`, so their `has_seen_intro` stays false. Route is `auth` only.
- **UX & screens:** Driver.js popovers styled in the app palette (rounded card, serif title, pill buttons Next/Back/Done, progress "N of M", overlay `#062019` at 55%, stage padding 8, radius 14, smooth scroll, close X). Steps (copy uses the platform brand name from `WADESK_BRAND.appName`): (1) welcome modal with no target, (2) the whole navbar, (3) Meta Ads nav item, (4) Campaigns, (5) Flows, (6) Templates, (7) Devices, (8) More, (9) KPI row, (10) "new campaign" button, (11) sales pipeline card. Anchors: `[data-tour="navbar"]`, `[data-tour="nav-<key>"]`, and on the dashboard `kpi`, `new-campaign`, `pipeline`.
- **Endpoints:**

| Method + uri     | Route name       | Controller@action         | Middleware | Request fields     | Response         |
| ---------------- | ---------------- | ------------------------- | ---------- | ------------------ | ---------------- |
| POST `tour/seen` | `user.tour.seen` | closure in routes/web.php | auth       | none (CSRF header) | JSON `{ok:true}` |

- **Data:** `users.has_seen_intro` (boolean, default false, set true by the closure only if currently false); mobile app registration sets it false too. Boot global `window.WADESK_TOUR = {run: !has_seen_intro, seenUrl, csrf, path}`.
- **Rules & edge cases:**
  1. Auto-runs only when the path is exactly `/dashboard` and `run` is true (or the URL has `?tour=1`), 650 ms after load. `?tour=1` is stripped from the URL with `history.replaceState`.
  2. Steps whose target is missing or not visible (`offsetParent == null`) are skipped, so: below lg the navbar is hidden and all nav steps are skipped; in sidebar mode there is no `data-tour="navbar"` so only welcome, KPI, new-campaign and pipeline remain; the Meta Ads step appears only if the admin promoted Meta Ads into the bar (not in the default bar); the pipeline step only when the plan has the pipeline card.
  3. Any exit (Done, X, Esc, overlay click) triggers `markSeen()` with a `keepalive` POST and sets `run=false`; the tour never auto-runs again.
  4. `window.wadeskStartTour()` replays: runs in place on the dashboard or navigates to `/dashboard?tour=1`. QUIRK: the code binds `[data-tour-replay]` elements but no view contains one, so there is no UI to replay the tour.
  5. QUIRK: the "quick-access" anchor exists on the dashboard but no tour step uses it.
  6. If no usable step remains, nothing runs and the flag is not set (it retries on the next dashboard load).
- **Async & events:** one POST.
- **External systems:** `driver.js` library (bundled).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a new owner with `has_seen_intro=false` on desktop topbar mode, when `/dashboard` loads, then the welcome step appears after about 0.65 s.
  - Given the user presses Esc mid-tour, when the tour closes, then `POST /tour/seen` is sent and `has_seen_intro` becomes true; on the next dashboard visit the tour does not run.
  - Given sidebar mode, when the tour runs, then no navbar/nav steps are shown.
  - Given `/dashboard?tour=1` for a user who has seen the tour, when loaded, then the tour runs once and the query string is removed.
- **Source refs:** resources/js/tour/guided-tour.js, resources/views/components/layouts/user.blade.php, routes/web.php (closure `user.tour.seen`), app/Models/User.php, app/Http/Controllers/Api/App/AuthController.php.
- **Port notes:** `users.has_seen_intro` (or `user_flags`); implement with a maintained tour library; add the missing replay entry in the help menu; make steps role/mode aware instead of relying on DOM presence.

### WD-ASHELL-024 — Theme switcher and persistence

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-ASHELL-010
- **Summary:** Each user picks one of four visual themes (paper, bright, dark (beta), doodle) from a small menu; the choice applies instantly, swaps the brand logo to that theme's variant, and is remembered in the browser.
- **Actors & access:** anyone with a shell (customer or admin).
- **UX & screens:** button `#wa-theme-btn` (icon changes to the active theme's icon); the menu is appended to `<body>` with fixed positioning under the button (right-aligned, flips when near the left edge): title "Theme", four rows with swatch (paper `#F5F3EC`, bright `#FFFFFF`, dark `#0B1F1C`, doodle gradient) and a check on the active one; labels "Paper (default)", "Bright white", "Dark (beta)", "Doodle (fancy)".
- **Endpoints:** none for the header switcher. The Settings Appearance tab (WD-ASHELL-046) posts to `settings/appearance`; the Instaflow rail toggle (extension) posts `theme_preference` (paper/dark) there too.
- **Data:** `localStorage['wa-theme']`, cookie `wa-theme` (path `/`, one year, SameSite=Lax), `users.theme_preference` (varchar(16), default `paper`), `<html data-theme>` (attribute removed for paper) and `<body data-theme>`.
- **Rules & edge cases:**
  1. Server render: `Brand::activeTheme()` = cookie value if it is one of the four themes, else `users.theme_preference` if valid, else `paper`. The user layout writes it to `body[data-theme]` and uses it to pick the logo variant so there is no logo flash.
  2. Client early script (before paint): prefers the server `body[data-theme]`, falls back to localStorage, then re-writes both caches. `x-theme-bootstrap` additionally sets `html` background per theme before CSS loads (paper `#F5F3EC`, bright `#FFFFFF`, dark `#0B1F1C` with `color-scheme: dark`, doodle `#E8F5E9`).
  3. `setTheme` updates html+body attributes, localStorage, cookie, icon and swaps every `img[data-brand-logo]` to `WADESK_BRAND.logos[theme]` (fallback paper logo); images marked `data-ws-logo` (workspace logo) are never swapped.
  4. QUIRK: the header switcher never persists to the server, so `users.theme_preference` only changes via Settings > Appearance (which cannot store doodle). A new browser/device starts from the DB value; because the cookie wins server-side, changing the theme in Settings without clearing the cookie has no visible effect on that browser until the cookie changes. (The Settings save also does not set the cookie.)
  5. Admin layout has no server `data-theme` on `<body>`, so admin relies on localStorage/cookie only.
  6. The user rail follows the theme unless the admin set a custom rail colour (WD-ASHELL-011).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** per-theme platform logos (admin General settings).
- **Acceptance criteria:**
  - Given the user picks "Dark (beta)", when the menu closes, then `<html data-theme="dark">`, the cookie and localStorage are `dark`, and the brand logo swaps to the dark variant without reload.
  - Given the cookie `wa-theme=doodle`, when the next page is server-rendered, then `body[data-theme]` is `doodle` and the doodle logo URL is in the initial HTML.
  - Given a workspace logo (white label), when the theme changes, then the workspace logo stays.
- **Source refs:** resources/js/wadesk.js (`applySavedTheme`, `setTheme`, `openThemeMenu`, `swapBrandLogo`), app/Support/Brand.php (`THEMES`, `activeTheme`), resources/views/components/theme-bootstrap.blade.php, resources/views/components/layouts/user.blade.php.
- **Port notes:** use `next-themes`-style attribute strategy with a cookie for SSR; persist to the user profile too so it follows the user across devices (WaDesk's split-brain between cookie and DB is a bug to avoid). Dark is labelled beta.

### WD-ASHELL-025 — Workspace white-label branding in the shell

- **Status:** partial
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-ASHELL-036
- **Summary:** A workspace owner can recolour the customer app for their own workspace and replace the header logo. Only some of what the Branding tab stores is actually applied.
- **Actors & access:** applies to every member of that workspace; configured by the workspace owner (WD-ASHELL-036). Customer shell only; the admin console ignores it.
- **UX & screens:** in the user layout head, when at least one of `workspaces.brand_primary`, `brand_accent`, `brand_background` is set, a `<style>` defines `--brand-primary/-accent/-bg` on `:root` and forces (with `!important`) the utility classes that carry the primary and accent tokens (`bg-wa-deep`, its hover/focus border variants, `text-wa-deep`, `bg-wa-teal`, `text-wa-teal`) and the `body` background. Header logo: when `brand_logo_path` is set the topbar header shows that image (alt = workspace name, `data-ws-logo`, never swapped by the theme switcher) instead of the platform logo. Workspace switcher avatars use `workspace_brand_color`.
- **Endpoints:** none of its own (save endpoint is WD-ASHELL-036).
- **Data:** `workspaces.brand_primary|brand_accent|brand_background` (varchar(16)), `brand_logo_path`, `brand_favicon_path`, `brand_color` (default `#075E54`, treated as "unset" by the avatar helper), `branding_footer` (outbound message footer, other domain).
- **Rules & edge cases:**
  1. QUIRK: `brand_favicon_path` is stored but never read by any layout (the favicon always comes from platform Brand settings), so the uploaded favicon has no effect.
  2. The sidebar rail ignores the workspace logo (topbar header only) and uses the platform logo.
  3. Colour values are validated at save as `#RRGGBB` so injection into the style block is limited to hex.
  4. White-label tenant domains (`ResolveTenantDomain`) are a WSP feature that locks the shell to one workspace; combine with this for a fully branded product.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none at platform level.
- **Acceptance criteria:**
  - Given `brand_primary=#5B3D8A`, when a member loads any page, then primary buttons render `#5B3D8A` and the platform theme override is superseded.
  - Given a workspace logo, when the theme is changed, then the logo does not change.
  - Given only `brand_favicon_path` is set, when a page loads, then the favicon is the platform favicon (WaDesk behaviour; the port should apply the workspace favicon).
- **Source refs:** resources/views/components/layouts/user.blade.php, resources/views/components/user/header.blade.php, app/Support/fc_helpers.php (`workspace_brand_color`), app/Models/Workspace.php.
- **Port notes:** implement as CSS variables on a tenant wrapper (no `!important` class rewrites); store logo/favicon in object storage (SET domain); apply favicon dynamically.

### WD-ASHELL-026 — Announcement bar, trial bar and renewal bar

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** PLAN, CMS
- **Summary:** Three full-width strips sit at the top of the customer shell: the platform announcement marquee, a free-trial countdown, and a last-7-days renewal reminder.
- **Actors & access:** all members of the workspace. Trial and renewal bars are hidden for platform admins (Spatie `Super Admin`/`Admin` or legacy role `admin|A|super-admin|platform-admin`). Not rendered in the admin console or on `hideHeader` pages.
- **UX & screens:** `components/announcement-bar.blade.php`: active announcements grouped by `tone`; one bar per tone; each bar is a marquee (two copies for seamless loop; duration = `max(20, totalChars/5)` seconds; pauses on hover); each item is plain text or a link (optional label with an arrow); a dismiss X shows when any item in the group is dismissible. `components/trial-bar.blade.php`: dark bar. Trial state (`workspace->onTrial()`): if seconds left <= 0 -> "free trial has ended" + Buy Now; else "N day(s)" (ceil, minimum 1) with buttons Connect Channel (`/devices`) and Buy Now (`/account/plans`). Renewal state (not on trial, `plan_ends_at` in the future and within 7 days): if an active `Subscription` exists -> "auto-renews in N day(s) on <date>" with Manage plan and Cancel auto-renew (form POST `account/subscription/cancel`, native confirm "Cancel auto-renew? Your plan stays active until it expires..."); otherwise -> "expires in N day(s) on <date>" with Renew now.
- **Endpoints:** POST `account/subscription/cancel` (PLAN, `workspace.role:manager`).
- **Data:** `announcements` (text<=500, link_url, link_label<=64, tone default `info`, is_active, dismissible, sort_order, starts_at, expires_at); cache key `announcements.active.v1` for 60 s; `workspaces.trial_ends_at`, `plan_ends_at`; `subscriptions` (active scope); orders (paid, latest) for renew target.
- **Rules & edge cases:**
  1. Active scope = `is_active` AND (starts_at null or <= now) AND (expires_at null or >= now), ordered by `sort_order`, `id`. Tone -> colours from the model's `toneClasses()`.
  2. Dismissal is client-only: `localStorage['dismissed:ann-<idsJoined>']=1`; the token is the joined ids of the tone group, so adding/removing an announcement in the group changes the token and the bar returns.
  3. Renew target: package from `billingPackage()` then `package()` then the latest paid order's package; "buyable" = not free, not lifetime, not custom quote, not `isFreePlan()`. QUIRK: the code guards on `Route::has('checkout.show')` but the real route name is `user.checkout.show`, so the guard is false and "Renew now" ALWAYS falls back to `/account/plans` (the one-click renew never engages).
  4. Free and lifetime plans have no `plan_ends_at`, so no renewal bar.
  5. The trial and renewal bars are non-dismissible by design.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** announcements are managed in the admin Announcements module (CMS).
- **Acceptance criteria:**
  - Given a workspace 3 days from trial end, when any customer page loads, then the bar says 3 days with Connect Channel and Buy Now.
  - Given a paid plan ending in 5 days with an active subscription, when the page loads, then the bar says it auto-renews and offers Cancel auto-renew.
  - Given two `info` announcements and one `warning`, when the page loads, then two bars render (one per tone).
  - Given the user dismisses a bar, when they reload, then it stays hidden; when the admin adds another announcement of the same tone, then it returns.
  - Given a platform admin, when they view the customer app, then no trial or renewal bar shows.
- **Source refs:** resources/views/components/announcement-bar.blade.php, trial-bar.blade.php, app/Models/Announcement.php.
- **Port notes:** announcements are a CMS list; trial/renewal state comes from PLAN's subscription record; fix the renew link to deep-link to checkout.

### WD-ASHELL-027 — Plan crown badges and in-app paywall sheet

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** PLAN
- **Summary:** Where a plan lacks a feature the shell shows a gold crown and, on gated pages, slides up a paywall sheet listing the plans that include it. Pages are never hard-redirected; mutations are blocked server-side (WD-ASHELL-002).
- **Actors & access:** members of a workspace whose effective plan lacks the feature. Platform admins never see crowns or the sheet.
- **UX & screens:** `components/plan-crown.blade.php` props `feature` (string or array), `any` (array semantics: any vs all; default all), `size` (sm/md/lg), `label`, `link` (default true -> anchor to `/account/plans`; false -> span, used inside cards). Tooltip default "Premium feature - upgrade your plan to unlock". Renders nothing when satisfied or for admins. `components/plan-paywall.blade.php`: bottom sheet titled "<Feature> is not on your plan" with plan cards (name, price or "Free" or "Custom", "/ mo", subtitle up to 70 chars, "Popular" tag when highlighted, CTA "Choose <plan>" -> `user.checkout.show`, "Continue free" -> plans page, "Talk to sales" -> `/support` for custom-quote plans) and footer links "Go back" (`/dashboard`) and "Compare all plans" (`/account/plans`). Slide-up is a CSS keyframe (`plan-paywall-rise`); no inline JS.
- **Endpoints:** none of its own.
- **Data:** feature source: (1) view-shared `planPaywall` set by `plan:` middleware, else (2) `config/plan_gates.php` map of request-path globs to feature keys (about 35 entries covering meta-ads, wa-campaigns, broadcasts, scheduled, templates, auto-reply, flows, ai-assistants, ai-training, wa-calling, call-logs, store, catalog, deals, chatbot-widgets, appointments, webhooks, analytics, shopify, woocommerce, hubspot, google-account). Plans listed = `packages` with `status=1` and the feature column `=1` (only when `packages` has a column named exactly like the feature), ordered by `sort_order`, `plan_amount`; price from `chargeableAmount()` with the package currency symbol.
- **Rules & edge cases:**
  1. Feature satisfaction = `PlanLimitGuard::hasFeature(workspace, key)` = workspace effective limit truthy (default true when unset); platform admins bypass.
  2. Label = shared label from EnforcePlanFeature or `ucfirst(key without access_ and underscores)`.
  3. If no plan lists the feature the sheet shows only the headline and links.
  4. Capability features without their own page are gated in context by `PlanLimitGuard::feature()/check()` (other domains), not by this map.
  5. QUIRK: `analytics` is in `plan_gates` but not in the sidebar catalogue's locked logic (WD-ASHELL-014); `deals` and the CRM hub use `access_sales_pipeline`.
  6. The sheet covers the page; users leave via the links only (no dismiss X), so a plan-less member cannot peek behind it.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `config/plan_gates.php`, package feature columns (PLAN).
- **Acceptance criteria:**
  - Given a plan without `autoflow`, when an owner opens `/flows`, then the page renders and the paywall sheet lists plans with `autoflow=1`.
  - Given the same plan, when the owner POSTs to a `plan:autoflow`-gated route, then the server returns 403 (JSON) or a warning flash (form).
  - Given a platform admin, when they open `/flows`, then no sheet and no crown show.
  - Given a custom-quote plan in the list, when the sheet renders, then its CTA is "Talk to sales" linking to `/support`.
- **Source refs:** resources/views/components/plan-crown.blade.php, plan-paywall.blade.php, config/plan_gates.php, app/Http/Middleware/EnforcePlanFeature.php, app/Services/PlanLimitGuard.php.
- **Port notes:** expose `GET /me/entitlements` (feature -> boolean/limit) so the shell can render crowns and locks without queries per item; keep the path-glob map as route metadata (`requiresFeature`) instead of a config file.

### WD-ASHELL-028 — Global new-message bell widget

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TIB1
- **Summary:** A floating pill on every customer page except Team Inbox announces unread customer conversations, beeps and flashes the tab title on new messages, and opens a mini list linking into the inbox.
- **Actors & access:** signed-in customer users; the backing endpoint (`GET team-inbox/api/unread-summary`, throttled 60/min, TIB1) decides scope by role.
- **UX & screens:** `components/user/inbox-bell.blade.php`: pill bottom-right (`#ibx-bell`), hidden at 0 unread; shows count (`99+` cap) and "N new messages"; click opens a 340px popup with up to 5 latest unread conversations (initials disc, title, preview, time (HH:MM today else short date), unread count) each linking to `/team-inbox#c=<id>`, header "New messages" with total, and a "View Inbox" button. Hover shows a dismiss X. The pill is draggable (4px slop) and its position `{x,y}` is stored in `localStorage['ibx-bell-pos']`, clamped inside the viewport on resize; the popup flips above/below and left/right based on position.
- **Endpoints:** consumes GET `team-inbox/api/unread-summary` -> `{total, items:[{id,title,preview,last_message_at,unread_count}]}`.
- **Data:** `sessionStorage['ibx-bell-dismissed']` = `{mark,total}` watermark.
- **Rules & edge cases:**
  1. Polling: setTimeout loop, 15 s base, doubled on HTTP 429 or errors up to 5 min, reset on success; skipped while the tab is hidden and one fetch fires on becoming visible.
  2. Dismiss hides the pill only until a newer message timestamp (`last_message_at` max) or a larger total appears; when the total reaches 0 the watermark is cleared.
  3. Beep (880 Hz sine via WebAudio, muted until the first user gesture) and title flash ("(N) title" toggling every 1.2 s until focus) fire only when the total increases after the first poll.
  4. QUIRK: the fetch URL is hard-coded to `/team-inbox/api/unread-summary` (ignores the sub-folder base) and the script logs to the console on every poll.
  5. Rendering is skipped when `navKey=team-inbox`.
- **Async & events:** 15 s polling; no websocket use here even when real-time is enabled.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 3 unread, when a customer page loads, then the pill shows 3 and the popup lists up to 5 conversations.
  - Given the user dismisses at total 3, when a new message arrives, then the pill returns.
  - Given HTTP 429, when polled, then the next poll interval doubles (max 300 s).
  - Given `/team-inbox`, when the page loads, then no widget is rendered.
- **Source refs:** resources/views/components/user/inbox-bell.blade.php, app/Http/Controllers/TeamInboxController.php (`unreadSummary`, TIB1).
- **Port notes:** feed from the realtime gateway; keep the drag and dismiss-watermark UX; respect notification sound preferences (WaDesk has none).

### WD-ASHELL-029 — Connect-device popover

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WADEV
- **Summary:** Any device picker can open a bottom-sheet/modal that embeds the channel connect flow so a user can add a number without losing a half-filled campaign or broadcast form.
- **Actors & access:** signed-in users (component renders only `@auth`); role/plan checks are those of the embedded `/devices` page.
- **UX & screens:** `components/user/connect-device-sheet.blade.php`: overlay + sheet (90vh bottom sheet on phones, 660px centered card >= sm) with title "Add a WhatsApp device", close X, a loading spinner and an `<iframe>` (same-origin referrer). Open via any element with `[data-connect-device]` or `window.openConnectDevice()`.
- **Endpoints:** loads GET `devices?embed=1` (WADEV).
- **Data:** none.
- **Rules & edge cases:**
  1. The iframe `src` is set lazily on first open and removed on close, which tears down the QR poller in the embedded page.
  2. While open: page scroll locked, quick-access drawer hidden and collapsed; Esc closes; overlay and X close.
  3. `postMessage` from the iframe: `wadesk:device-connected` -> dispatch `device:connected`, toast "Device connected.", close, then after 500 ms re-fetch the current page and replace the innerHTML of each `[data-device-picker]` node (fallback `location.reload()` when there is no picker or the fetch fails), dispatching `device:pickers-refreshed`; `wadesk:connect-close` -> close.
  4. QUIRK: the message handler does not check `event.origin`/`source`; any window can trigger a close or refresh (low impact, port should validate).
- **Async & events:** window message events; a refresh fetch.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a campaign form with an empty device picker, when the user opens the popover and connects a device, then the sheet closes and the picker lists the new device with the form fields unchanged.
  - Given the sheet is open, when the user presses Esc, then it closes and the iframe source is cleared.
- **Source refs:** resources/views/components/user/connect-device-sheet.blade.php, resources/js/app.js (`initConnectDevice`, `refreshDevicePickers`), resources/views/user/partials/_connect-device-link.blade.php.
- **Port notes:** prefer a routed modal (intercepting route) over an iframe; keep the "device connected" event on the client event bus.

### WD-ASHELL-030 — Impersonation banner strip

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WSP, RBAC
- **Summary:** While a platform admin is "viewing as" a customer workspace, a sticky amber strip is shown on every customer page with the workspace, the reason and a Stop button.
- **Actors & access:** platform admins holding permission `platform.workspace.impersonate` (Spatie), session-bound to the browser that started it. Start endpoint `POST admin/impersonate/{workspaceId}` (reason required, 8-500 chars) and stop endpoint `POST admin/impersonate/stop` belong to WSP.
- **UX & screens:** in `layouts/user`: sticky top, z-60, amber bar: "Impersonating", bold workspace name, reason (md+), form button "Stop impersonating" posting to `/admin/impersonate/stop`. Not rendered in the admin layout.
- **Endpoints:** consumed only.
- **Data:** `impersonation_sessions` (admin_user_id, target_workspace_id, original_workspace_id, reason<=500, ip, user_agent<=500, started_at, ended_at); session key `impersonation_session_id`.
- **Rules & edge cases:**
  1. `ImpersonationBanner` middleware: skipped before install; without the session key the view variable is null and nothing changes; with an active row for this admin and key it re-verifies `platform.workspace.impersonate` EVERY request (revoked -> the row is force-ended and the user falls through as normal).
  2. The workspace override is applied to the in-memory user only (`setAttribute` then `syncOriginalAttribute`) so no later `save()` persists the target id onto the admin row.
  3. During impersonation `workspaceRole()` returns Owner for the target workspace so the admin can act fully; `EnsureWorkspaceMembership` exempts impersonated workspaces.
  4. Stop closes the session, audits `impersonation.stopped` with duration and event counts by action/module, restores the admin's original workspace (or the first one they belong to), and redirects to `/admin/team-inbox`.
  5. QUIRK: the strip form's action is a hard-coded admin URL, so the IP allowlist also applies when stopping.
- **Async & events:** audit events `impersonation.started/stopped` (WSP).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active impersonation in this browser session, when any customer page loads, then the amber strip shows the target workspace name and the reason.
  - Given the same admin account in a second browser with no session key, when they load a page, then no strip and their own workspace is used.
  - Given the admin's platform role is revoked mid-session, when the next request arrives, then the session ends and the strip disappears.
- **Source refs:** app/Http/Middleware/ImpersonationBanner.php, resources/views/components/layouts/user.blade.php, app/Http/Controllers/Admin/ImpersonationController.php, app/Models/User.php (`workspaceRole`, `isImpersonatingWorkspace`).
- **Port notes:** implement with a signed impersonation claim in the session; render the banner from `GET /me` (`impersonation` object).

### WD-ASHELL-031 — UI kit: progress bar, toaster, modals, hints, skeleton, list/grid toggle

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-ASHELL-012
- **Summary:** A handful of global UI behaviours installed by the JS bundle that every page relies on.
- **Actors & access:** every layout that loads `resources/js/app.js`.
- **UX & screens:**
  - **Top progress bar** (`#wa-topbar`, 3px gradient at viewport top): flashes complete on load; starts and climbs to 90% when a same-origin link is clicked (except anchors, `_blank`, `download`, `mailto/tel/javascript`, `data-noprogress`) or a non-GET form submits; completes when the next page loads, when any `fetch`/XHR settles while pending (fetch and XHR are monkey-patched), or after a 12 s backstop; reset on bfcache restore; hidden on the installer page; exposed as `window.WaProgress.start/done`.
  - **Toaster** (`window.WaToaster.success|error|warn|info`, `showToast(msg,{variant,title,duration})`): bottom-right stack, default 3 s, `duration:0` sticky; reads the `wa-flash` meta on load. A legacy `window.toast(msg,type)` (Toastify, top-right, 2.5 s) remains for older pages.
  - **Modals** (`lib/ui-modal.js`): `uiAlert`, `uiConfirm`, `uiPrompt` promises (tones warning/danger/info/prompt; Esc and outside click; scroll lock) and declarative `form[data-confirm]` and `form[data-prompt-reason][data-min-length]`; `window.confirmDialog({title,message,confirmText,tone,onConfirm})` and `form[data-confirm-form]` use the older `<x-confirm-modal>`.
  - **Info hint** (`<x-info-hint text title align>`): click-to-open help bubble.
  - **Skeleton** (`<x-skeleton kind=row|card|tableRow|text rows=N>`), **side tip** (`<x-side-tip title>`).
  - **List/grid toggle** (`<x-list-grid-toggle active target>` + `list-grid-toggle.js`): converts a table's rows into cards, remembers the view in `localStorage['wadesk:list-grid:<key>']`.
  - **Tabs** (`[data-wa-tabs]`) and **file image preview** (`input[type=file][data-preview-target]`).
  - **Sub-folder base path**: `app-base` meta and `wurl()`/`lib/base-url` prefix root-relative URLs so the app works under `/public`.
- **Endpoints:** none.
- **Data:** localStorage keys above.
- **Rules & edge cases:** progress bar hooks are installed once (`__waProgressHooked`); polling requests do not flash the bar because completion only follows a pending `start()`; prompts enforce `min-length` client-side only.
- **Async & events:** none.
- **External systems:** `toastify-js` (legacy toast).
- **Settings:** none.
- **Acceptance criteria:**
  - Given the user clicks an internal link, when the request starts, then the bar climbs to ~90% and completes on the next page.
  - Given a form with `data-confirm`, when submitted, then a modal appears and the form submits only after confirmation.
  - Given `WaToaster.error('x')`, when called, then a toast appears bottom-right and disappears after ~3 s.
- **Source refs:** resources/js/wadesk.js (`initTopProgress`, tabs, previews), resources/js/wa-toaster.js, resources/js/lib/ui-modal.js, lib/info-hint.js, resources/js/list-grid-toggle.js, resources/js/app.js (`window.toast`, `confirmDialog`), resources/views/components/{confirm-modal,info-hint,skeleton,side-tip,list-grid-toggle}.blade.php.
- **Port notes:** use the target design system (toast, dialog, skeleton, tabs); the progress bar maps to `nextjs-toploader`. Do not port the fetch/XHR monkey-patching.

### WD-ASHELL-032 — Customer Settings hub and tab shell (`/settings`)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-ASHELL-012
- **Summary:** `/settings` is the workspace settings page with nine tabs. Any member can open it; only the workspace owner can change things.
- **Actors & access:** any authenticated user (route has `auth` only; no `workspace.role`). Write endpoints below use an owner check (`workspaces.owner_user_id == user.id`, else 403 "Owner only." / 404 "No workspace.") except where noted. Plan gates: BYOK keys (WD-ASHELL-039).
- **UX & screens:** `resources/views/user/settings/index.blade.php` (nav-key `more`, page `user-settings-index`). Left rail: group "Workspace": General, Branding, Team & roles, Notifications, AI keys; group "System": Security, API & webhooks, Data & export, Appearance; and a "Personal" card "Your account" linking to `/account`. Tab is chosen by `?tab=<general|branding|team|notifications|aikeys|security|api|data|appearance>` (default general, unknown -> general); links call `history.pushState`, swap panes client-side, update breadcrumb ("More > Settings > <tab>"), title and description, and support back/forward. Non-owners see disabled inputs plus a note. Page data preloaded server-side: BYOK rows, 2FA enrolment secret/URL, active sessions (paginated), workspace members.
- **Endpoints:**

| Method + uri   | Route name      | Controller@action            | Middleware | Request fields        | Response |
| -------------- | --------------- | ---------------------------- | ---------- | --------------------- | -------- |
| GET `settings` | `user.settings` | UserPagesController@settings | auth       | `tab`, `session_page` | HTML     |

- **Data:** see the per-tab features. Reads `ai_provider_keys`, `sessions`, `workspace_user` + `users` (members), session key `two_factor_settings_secret`.
- **Rules & edge cases:**
  1. 2FA enrolment secret is generated lazily per session when 2FA is off (stored in session until confirmed).
  2. QUIRK: the sessions-load error handler references an undefined `$userId` variable; if that catch block runs it raises a second error instead of logging.
  3. QUIRK: the page sets `nav-key="more"` so top-nav highlighting shows More, and the breadcrumb links to `/more` even in sidebar mode.
  4. The "Test key" helper in `user-settings-index.js` (`testKey`) simulates success with a timeout and is not wired to any button (dead).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `/settings?tab=security`, when the page loads, then the Security pane is visible and its rail item is active; clicking General changes the URL to `?tab=general` without a reload.
  - Given a non-owner member, when the page loads, then inputs are disabled and a note explains that only the owner can change them.
  - Given an unknown tab, when the page loads, then General shows.
- **Source refs:** app/Http/Controllers/UserPagesController.php (`settings`), resources/views/user/settings/index.blade.php, resources/js/charts/user-settings-index.js.
- **Port notes:** each tab becomes its own route segment (`/settings/security`) so deep links and permission checks are simple.

### WD-ASHELL-033 — Settings General: workspace name, timezone, currency

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-ASHELL-032, WSP
- **Summary:** The owner edits the workspace's display name, default timezone and currency.
- **Actors & access:** workspace owner (non-owners get a redirect with "Only the workspace owner can edit these." and no change).
- **UX & screens:** General pane form: Workspace name (max 191), Workspace URL (read-only; slug, "isn't editable here - contact support"), Default timezone (all PHP identifiers; helper: scheduled sends, business hours and SLA timers run in this zone), Currency (active `currencies` ordered by code, "CODE - Name (symbol)"; used for checkout, invoices and wallet display), Cancel and Save. Flash keys `settings_status`.
- **Endpoints:**

| Method + uri    | Route name             | Controller@action                  | Middleware | Request fields                                                                                                                                         | Response                                                         |
| --------------- | ---------------------- | ---------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| POST `settings` | `user.settings.update` | UserPagesController@settingsUpdate | auth       | `workspace_name` nullable string max 191; `timezone` nullable string max 64 valid timezone; `currency` nullable string max 10 `exists:currencies,code` | redirect to `/settings` with `settings_status` "Settings saved." |

- **Data:** `workspaces.name`, `timezone` (default UTC), `currency` (uppercased). Empty values are ignored (fields cannot be cleared).
- **Rules & edge cases:**
  1. No current workspace -> flash "No workspace." back.
  2. After saving, `FormatSettings::flushCache()` clears cached formatting.
  3. Slug is never changed here; the slug landing URL is owned by WSP.
  4. QUIRK: validation errors are shown as the first error in a banner, not per field.
  5. Not audited.
- **Async & events:** cache flush only.
- **External systems:** none.
- **Settings:** `default_currency` (platform) seeds the displayed default.
- **Acceptance criteria:**
  - Given the owner sets timezone `Asia/Kolkata` and currency `inr`, when saved, then the workspace row has `Asia/Kolkata` and `INR`.
  - Given a non-owner, when they submit, then nothing changes and they see the owner-only message.
  - Given `timezone=Mars/Base`, when submitted, then validation fails and nothing is written.
- **Source refs:** app/Http/Controllers/UserPagesController.php (`settingsUpdate`), app/Support/FormatSettings.php.
- **Port notes:** timezone must be an IANA zone from a fixed list; currency FK to the platform currency table.

### WD-ASHELL-034 — Settings General: working hours card (static)

- **Status:** docs-only
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-ASHELL-033
- **Summary:** The General tab shows a "Working hours" card (Mon-Fri 09:00-18:00 on, Saturday 10:00-14:00 on, Sunday off) that looks editable but is not connected to anything.
- **Actors & access:** owner/members see it.
- **UX & screens:** three rows with a toggle and two time inputs; Sunday's inputs disabled. Not inside a form; no save button.
- **Endpoints:** none.
- **Data:** none stored.
- **Rules & edge cases:** business-hours behaviour that other domains implement (auto-reply out-of-hours, SLA) uses their own settings, not this card. Port should either build it as real per-workspace business hours (owned by TIB2/AR) or omit.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the card, when a user changes a time and reloads, then the values revert (documenting the WaDesk behaviour so the port does not treat it as a feature to match).
- **Source refs:** resources/views/user/settings/index.blade.php (General pane).
- **Port notes:** do not port as is; link to the real business-hours editor.

### WD-ASHELL-035 — Settings: personal preferences (auto AI summarize)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-ASHELL-032, AICRM
- **Summary:** A per-user toggle enabling a live AI review under every message-body textarea (`<x-compose-textarea>`); when off, the review runs only from the sparkle button.
- **Actors & access:** any signed-in user (per-user; no owner check). Uses AI credits/keys of the workspace (AIADM).
- **UX & screens:** card on the General tab with a switch and Save (hidden field sends `0` when unticked).
- **Endpoints:**

| Method + uri                | Route name                  | Controller@action                        | Middleware | Request fields                                   | Response                                 |
| --------------------------- | --------------------------- | ---------------------------------------- | ---------- | ------------------------------------------------ | ---------------------------------------- |
| POST `settings/preferences` | `user.settings.preferences` | SettingsTabsController@updatePreferences | auth       | `auto_ai_summarize_enabled` nullable in `0,1,on` | back with success "Preferences updated." |

- **Data:** `users.auto_ai_summarize_enabled` (tinyint, default 0).
- **Rules & edge cases:** value cast with `boolean()`; no audit.
- **Async & events:** none here (the compose component debounces AI calls).
- **External systems:** AI providers via the compose component (AICRM).
- **Settings:** none.
- **Acceptance criteria:**
  - Given the switch is on and saved, when the user types in a compose textarea, then the AI review is requested automatically after a debounce.
  - Given the switch off, when the user types, then no request is sent until the sparkle is clicked.
- **Source refs:** app/Http/Controllers/SettingsTabsController.php (`updatePreferences`), resources/views/components/compose-textarea.blade.php.
- **Port notes:** store in a user preferences JSON; gate by plan feature if AI costs credits.

### WD-ASHELL-036 — Settings Branding: logo, favicon, brand colours

- **Status:** partial
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-ASHELL-032
- **Summary:** The owner uploads a workspace logo and favicon and picks three brand colours; they feed the white-label rendering in WD-ASHELL-025.
- **Actors & access:** workspace owner only (403 "Owner only." otherwise).
- **UX & screens:** Branding pane: Logo dropzone (PNG/SVG/JPG, max 2 MB, recommended 240x80) and Favicon dropzone (max 512 KB) with drag-drop, live preview and "Current" thumbnail; Brand colours Primary, Accent, Background (colour input + text input synced both ways); "Save branding".
- **Endpoints:**

| Method + uri             | Route name               | Controller@action                     | Middleware | Request fields | Response     |
| ------------------------ | ------------------------ | ------------------------------------- | ---------- | -------------- | ------------ |
| POST `settings/branding` | `user.settings.branding` | SettingsTabsController@updateBranding | auth       | `brand_primary | brand_accent | brand_background`nullable`#RRGGBB`; `logo`image max 2048 KB;`favicon` image max 512 KB (multipart) | back with success "Branding updated." |

- **Data:** files stored on the `public` disk under `branding/<workspaceId>/`; columns `brand_logo_path`, `brand_favicon_path`, `brand_primary`, `brand_accent`, `brand_background`.
- **Rules & edge cases:**
  1. The `image` rule allows raster types (SVG acceptance depends on the framework version; the UI says SVG is allowed).
  2. Colours cannot be cleared (a blank value posts as null and IS written, resetting to default; absent fields are untouched).
  3. Old files are not deleted when replaced.
  4. No audit; no plan gate.
  5. Favicon has no effect (WD-ASHELL-025).
  6. Note the separate `POST account/branding` (`AccountController@updateBranding`, PLAN/CPN domain) sets the plan-gated outbound message footer `branding_footer` (max 60); it is NOT this form.
- **Async & events:** none.
- **External systems:** local `public` disk (SET storage domain in port).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a valid logo and colours, when saved, then the header shows the logo and buttons use the primary colour.
  - Given `brand_primary=red`, when submitted, then validation fails with the regex error.
  - Given a non-owner member, when they POST, then 403.
- **Source refs:** app/Http/Controllers/SettingsTabsController.php (`updateBranding`), resources/views/user/settings/index.blade.php, resources/js/charts/user-settings-index.js.
- **Port notes:** use the tenant-scoped object storage adapter; delete replaced files; validate SVG safely (sanitise).

### WD-ASHELL-037 — Settings Team and roles tab (read-only roster)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-ASHELL-032, TIB2
- **Summary:** A read-only table of workspace members with a seat counter and a link to the real member-management page.
- **Actors & access:** any member sees it.
- **UX & screens:** header "Team members" with "N of LIMIT seats used" (limit from `effectiveLimit('user_seat_limit')`, blank when unlimited) and a "Manage members" button to `route('user.team-inbox.members')` (`/team-inbox/members`); table Name (initials avatar + "(you)" marker), Email, Role (Owner for the owner row else pivot role or "member"), Status (`invited` when `joined_at` is null, else `active`); empty state "No members yet" with an "Invite the first one" link.
- **Endpoints:** none of its own.
- **Data:** `workspace_user` joined to `users` (id, name, email, role, joined_at).
- **Rules & edge cases:** no pagination; invitations and role changes live in WorkspaceMembersController (TIB2/WSP), not here; the class comment mentions a "team" save endpoint that does not exist in this controller.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `user_seat_limit` (plan).
- **Acceptance criteria:**
  - Given 3 members and a seat limit of 5, when the tab renders, then it says "3 of 5 seats used".
  - Given a pending invite (`joined_at` null), when rendered, then its status is `invited`.
- **Source refs:** app/Http/Controllers/UserPagesController.php (`settings`), resources/views/user/settings/index.blade.php.
- **Port notes:** replace with a live members query; link to the team module.

### WD-ASHELL-038 — Settings Notifications: per-event and per-category matrix

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** NOTIF
- **Summary:** The owner chooses, for 18 named events and for record categories, whether each produces an in-app bell entry, an email and/or a Slack message, and provides the Slack incoming-webhook URL.
- **Actors & access:** workspace owner edits; members see it read-only ("Read-only - workspace owner can edit these.").
- **UX & screens:** three cards in one form: (1) "Specific events" table with In-app / Email / Slack toggles per event; (2) "By category" catch-all toggles for auto-recorded create/update/delete events per object type ("a specific-event toggle always overrides these"); (3) Slack incoming webhook URL field with help and a "Channel status" list (in-app live; email live when SMTP configured, linking to admin mail; Slack live only when a URL is set). Events (keys): device_connected, device_disconnected, campaign_completed, campaign_failed, broadcast_completed, new_customer_reply, mention_in_inbox, conversation_assigned, sla_breached, wallet_low_balance, plan_changed, payment_failed, webhook_delivery_failed, flow_started, flow_failed, integration_disconnected, appointment_booked, weekly_summary. Default toggles come from `Workspace::NOTIFICATION_EVENTS` and a defaults array (quiet email, critical events light the bell).
- **Endpoints:**

| Method + uri                  | Route name                    | Controller@action                          | Middleware | Request fields      | Response |
| ----------------------------- | ----------------------------- | ------------------------------------------ | ---------- | ------------------- | -------- |
| POST `settings/notifications` | `user.settings.notifications` | SettingsTabsController@updateNotifications | auth       | `prefs[event][inapp | email    | slack]`, `cat_prefs[category][inapp | email | slack]`each in`0,1,on`; `slack_webhook` nullable url max 255 | back with success "Notification preferences saved." |

- **Data:** `workspaces.notification_prefs` JSON: `{ "<event>": {inapp,email,slack}, "_categories": {"<cat>": {...}}, "_slack_webhook": "<url>" }`.
- **Rules & edge cases:**
  1. Each toggle is normalised to a strict boolean (hidden `0` inputs make unchecked boxes arrive).
  2. The dispatcher (`NotificationHelper`, NOTIF domain) checks these prefs before emitting; events never listed fall back to defaults.
  3. Owner-only save; no audit; the webhook URL is stored in clear JSON.
- **Async & events:** none here; NOTIF consumes the prefs.
- **External systems:** Slack incoming webhook (customer-supplied URL) used by NOTIF.
- **Settings:** platform SMTP (admin mail settings).
- **Acceptance criteria:**
  - Given the owner turns off email for `payment_failed` and saves, when a payment fails, then no email is sent but the bell entry is still created.
  - Given `slack_webhook=notaurl`, when submitted, then validation fails.
  - Given a member (non-owner) posts, then 403.
- **Source refs:** app/Http/Controllers/SettingsTabsController.php (`updateNotifications`), app/Models/Workspace.php (`NOTIFICATION_EVENTS`), resources/views/user/settings/index.blade.php.
- **Port notes:** per-user vs per-workspace preferences are separate in the target's NOTIF domain; keep the workspace-level matrix here and add per-user overrides there. Encrypt or vault the Slack URL.

### WD-ASHELL-039 — Settings AI keys (bring your own key)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** AIADM, PLAN
- **Summary:** Where the plan allows it, the owner stores their own API key for any of 22 AI providers; otherwise the workspace uses the platform's shared keys and the tab shows the monthly token meter.
- **Actors & access:** owner only for writes. Plan gate: `allow_byok_ai_keys` on the workspace's effective plan; platform admins are exempt.
- **UX & screens:** status card ("BYOK enabled" or "Shared AI" with upgrade link; when on shared AI, tokens used this month vs `ai_token_limit_monthly` with a percent bar, or "unlimited"), note "keys are encrypted at rest and never sent to other tenants". One card per provider with a source badge: "Your key" (workspace key and BYOK allowed), "Shared key" (admin key active), "Not configured"; password field (eye toggle), Save, Generate-at link, and "Remove" with a confirm when a key exists; when BYOK is not allowed the card shows the shared-key state only. Providers (slug: name): openai, anthropic, gemini, mistral, deepseek, xai, perplexity, groq, qwen, moonshot, zai, cohere, nvidia, llama, huggingface, baidu, ai21, reka, yi, openrouter, elevenlabs, deepgram. A "Where keys are used" explainer lists AI Assist node, Generate flow with AI, smart canned replies.
- **Endpoints:**

| Method + uri                        | Route name                    | Controller@action                  | Middleware | Request fields                     | Response                                                                                                    |
| ----------------------------------- | ----------------------------- | ---------------------------------- | ---------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| POST `settings/aikeys/{provider}`   | `user.settings.aikeys.update` | SettingsTabsController@updateAiKey | auth       | `api_key` required string max 1024 | back: success "<Provider> key saved." or error "Your plan does not include Bring Your Own Keys. Upgrade..." |
| DELETE `settings/aikeys/{provider}` | `user.settings.aikeys.remove` | SettingsTabsController@removeAiKey | auth       | none                               | back: success "<Provider> key removed. Falling back to admin key."                                          |

- **Data:** `ai_provider_keys` (workspace_id, provider varchar(32), api_key text encrypted by the model mutator/cast, is_active default 1; unique (workspace_id, provider)). `AiTokenMeter::usedThisMonth`.
- **Rules & edge cases:**
  1. `updateOrCreate` by (workspace, lower-cased provider); `is_active` forced true.
  2. QUIRK: the provider slug is not validated against the 22-provider list; any path segment (<=32 chars by column) creates a row.
  3. QUIRK: the field placeholder says "leave blank to keep" but the rule is `required`, so a blank submit fails validation.
  4. Removing does not check plan; removal always allowed for the owner.
  5. Effective source per provider: workspace key when present AND BYOK allowed; else the admin key if active; else none (AI features fail elsewhere).
  6. No audit and no key validation ping (the "test key" JS is dead).
  7. Keys are never re-emitted to the page; only presence is shown.
- **Async & events:** none.
- **External systems:** each provider's API (calls made by the AI domains, not here).
- **Settings:** plan limits `allow_byok_ai_keys`, `ai_token_limit_monthly`; admin AI keys (AIADM).
- **Acceptance criteria:**
  - Given a BYOK plan, when the owner saves an OpenAI key, then a row exists and the badge reads "Your key".
  - Given a plan without BYOK, when the owner POSTs a key, then the response carries the upgrade error and no row is written.
  - Given a saved key, when the owner clicks Remove and confirms, then the row is deleted and the badge falls back to "Shared key" if an admin key is active.
  - Given a non-owner, when they POST, then 403.
- **Source refs:** app/Http/Controllers/SettingsTabsController.php (`updateAiKey`, `removeAiKey`), app/Models/AiProviderKey.php, app/Models/AdminAiKey.php, app/Services/AiTokenMeter.php, resources/views/user/settings/index.blade.php.
- **Port notes:** encrypt with the platform KMS/secret store; whitelist providers; add a "test key" call; record audit events.

### WD-ASHELL-040 — Settings Security: two-factor enrolment and disable

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** AUTH
- **Summary:** Any user can turn on TOTP two-factor authentication from Settings > Security and turn it off with their password. Login enforcement lives in AUTH.
- **Actors & access:** any signed-in user, for their own account (no owner requirement).
- **UX & screens:** Security pane card. When off: three steps (open an authenticator, scan QR or paste secret, enter the 6-digit code), QR image and secret text, code input and "Enable 2FA". When on: "Confirm with password" and "Disable 2FA". QUIRK: the QR is rendered by loading `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=<otpauth url>` from a third party, which leaks the TOTP secret to that service; the port must render the QR locally.
- **Endpoints:**

| Method + uri                | Route name                  | Controller@action                       | Middleware | Request fields                | Response                    |
| --------------------------- | --------------------------- | --------------------------------------- | ---------- | ----------------------------- | --------------------------- |
| POST `settings/2fa/enable`  | `user.settings.2fa.enable`  | SettingsTabsController@enableTwoFactor  | auth       | `code` required string max 10 | back with success or errors |
| POST `settings/2fa/disable` | `user.settings.2fa.disable` | SettingsTabsController@disableTwoFactor | auth       | `current_password` required   | back with success or errors |

- **Data:** `users.two_factor_enabled`, `two_factor_secret`, `two_factor_confirmed_at`, `two_factor_recovery_codes`; session key `two_factor_settings_secret`; audit rows via `SecurityAuditLogger`.
- **Rules & edge cases:**
  1. Enable: already on -> success "already enabled"; no session secret -> error "Two-factor setup expired. Refresh the page to generate a new code."; code checked with `TwoFactorService::verifyCode(secret, code)`; failure -> field error "The authentication code is invalid." and audit `two_factor_failed` (failed); success -> stores secret, confirmed_at=now, clears the session secret, audit `two_factor_enabled` (success), flash "Two-factor authentication enabled."
  2. Disable: already off -> success message; wrong password -> field error "Wrong password."; success nulls enabled/secret/confirmed_at/recovery codes, audit `two_factor_disabled` (info).
  3. QUIRK: enabling does not generate recovery codes (the column is only cleared on disable), so a lost authenticator has no self-service recovery.
  4. QUIRK: the secret is stored in `two_factor_secret` as returned (encryption depends on the model cast; see AUTH).
  5. No rate limit on code attempts here.
- **Async & events:** audit events only.
- **External systems:** third-party QR image host (see above).
- **Settings:** platform `Force2FA` policy (AUTH).
- **Acceptance criteria:**
  - Given 2FA is off and a valid current TOTP code, when enabling, then the account has 2FA enabled and an audit row exists.
  - Given a wrong code, when enabling, then the error appears and nothing is stored.
  - Given 2FA on and the right password, when disabling, then secret and recovery codes are nulled.
- **Source refs:** app/Http/Controllers/SettingsTabsController.php, app/Support/TwoFactorService.php, app/Support/SecurityAuditLogger.php, app/Http/Middleware/Force2FA.php.
- **Port notes:** AUTH owns the credential model; implement enrolment as a start/confirm API pair with recovery codes and throttling.

### WD-ASHELL-041 — Settings Security: active sessions and revoke

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** AUTH
- **Summary:** Users see where they are signed in (one row per device) and can sign out a device or all others.
- **Actors & access:** any signed-in user, own sessions only.
- **UX & screens:** Security pane table: Device (user agent parsed), IP, Last active, Sessions count ("merged" tooltip: login regenerates the session id so one browser owns many rows), a "this session" tag, per-row Revoke, header "Sign out of all others", pagination Prev/Next (10 per page, `session_page`, hash `#tab=security`). Empty state explains `SESSION_DRIVER=database`.
- **Endpoints:**

| Method + uri                           | Route name                             | Controller@action                             | Middleware | Request fields  | Response                                   |
| -------------------------------------- | -------------------------------------- | --------------------------------------------- | ---------- | --------------- | ------------------------------------------ |
| DELETE `settings/sessions/{id}`        | `user.settings.sessions.revoke`        | SettingsTabsController@revokeSession          | auth       | path session id | back: success "Session revoked." / error   |
| POST `settings/sessions/revoke-others` | `user.settings.sessions.revoke-others` | SettingsTabsController@revokeAllOtherSessions | auth       | none            | back: success "<n> session(s) signed out." |

- **Data:** `sessions` table (id, user_id, ip_address, user_agent, payload, last_activity). List = rows for the user with `last_activity` newer than `now - session.lifetime` (default 120 min), grouped by `(ip, md5(user_agent))` keeping the newest id, with a merged count and an `is_current` flag; current device first, then by recency.
- **Rules & edge cases:**
  1. Revoking the current session id is refused ("Use the logout button to end the current session.").
  2. Revoke matches `id` AND `user_id`; unknown -> error "Session not found."
  3. Revoke-others deletes every row of the user except the current one and reports the row count (not the device count).
  4. Audit: `session_revoked` (meta session_id), `all_sessions_revoked` (meta count).
  5. QUIRK: revoking a grouped row deletes only the newest session id of that device; older merged ids stay and the device may reappear.
- **Async & events:** audit events.
- **External systems:** none.
- **Settings:** `SESSION_LIFETIME`, session driver (must be `database`).
- **Acceptance criteria:**
  - Given three sessions from one browser and one from a phone, when the tab loads, then two rows show with counts 3 and 1.
  - Given "Sign out of all others", when confirmed, then only the current session remains and the flash reports the deleted row count.
  - Given the current session id, when revoke is requested, then it is refused.
- **Source refs:** app/Http/Controllers/UserPagesController.php (`settings` sessions block), SettingsTabsController.php, resources/views/user/settings/index.blade.php.
- **Port notes:** store device sessions as first-class rows with a device fingerprint so merging is not needed; revoke all rows of a device.

### WD-ASHELL-042 — Settings API and webhooks tab (informational)

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** API, INTG
- **Summary:** A summary tab about integration surfaces: the Google Sheets add-on API key status, the outbound/inbound webhook counts and links to manage them. It has no controls of its own.
- **Actors & access:** members see it.
- **UX & screens:** Sheets key card (active with masked suffix `wsn_live_****<suffix>`, created and last-used times, or "No Sheets API key generated" with a link to `/account#sheets-api`), "General REST API" explainer list, Webhooks card with counts of outbound (`outbound_webhooks`) and inbound (`webhooks`) endpoints for the workspace and a "Manage webhooks" link.
- **Endpoints:** none.
- **Data:** `users.sheets_api_key_suffix`, `sheets_api_key_created_at`, `sheets_api_key_last_used_at`; `outbound_webhooks`, `webhooks` counts by `workspace_id`.
- **Rules & edge cases:** counts silently fall back to 0 on any error; the REST API (API domain) keys are managed elsewhere (`/developers`), and the tab text points to them only loosely.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a generated Sheets key ending `abcd`, when the tab renders, then it shows `wsn_live_****abcd` and the last-used time.
  - Given 2 outbound and 1 inbound webhooks, when rendered, then the counts read 2 and 1.
- **Source refs:** resources/views/user/settings/index.blade.php (API pane).
- **Port notes:** point this tab at the API-keys and webhooks modules; no separate backend.

### WD-ASHELL-043 — Settings Data export (contacts, conversations, messages CSV)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** CON, TIB1
- **Summary:** The owner downloads three CSV exports of workspace data from the Data tab.
- **Actors & access:** workspace owner (403 otherwise). No plan gate.
- **UX & screens:** Data pane cards for Contacts, Conversations, Messages, each a link streaming a fresh CSV.
- **Endpoints:**

| Method + uri                 | Route name             | Controller@action                 | Middleware | Request fields      | Response      |
| ---------------------------- | ---------------------- | --------------------------------- | ---------- | ------------------- | ------------- |
| GET `settings/export/{type}` | `user.settings.export` | SettingsTabsController@exportData | auth       | `type` in `contacts | conversations | messages` | streamed `text/csv` download named `<type>.csv`; unknown type -> back with error "Unknown export type." |

- **Data:** contacts columns: id, name, mobile, email, status, created_at (ISO 8601); conversations: id, channel, status, last_message_at, created_at (`conversations.workspace_id`); messages: id, conversation_id, direction, body (first 500 chars only), created_at from `inbox_messages` joined by the workspace's conversation ids. Rows are streamed with a DB cursor (no memory blow-up).
- **Rules & edge cases:**
  1. QUIRK: contacts are selected by `user_id IN (members of the workspace)` rather than `workspace_id`, so contacts of another workspace owned by the same users leak into the file, and contacts imported by a removed member are missed.
  2. Message bodies are truncated to 500 chars; media, notes and templates are not exported; no date filters; no audit row.
  3. CSV is written with `fputcsv` (no formula-injection escaping for cells starting with `=`, `+`, `-`, `@`).
  4. `messages` uses an `IN (...)` on all conversation ids, which is heavy for large workspaces.
- **Async & events:** none (synchronous stream).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the owner requests `contacts`, when the response starts, then the header is `id,name,mobile,email,status,created_at` and rows stream.
  - Given `type=foo`, when requested, then the user is sent back with an error flash.
  - Given a member (non-owner), when requested, then 403.
- **Source refs:** app/Http/Controllers/SettingsTabsController.php (`exportData`, `stream*`), resources/views/user/settings/index.blade.php.
- **Port notes:** scope by tenant id via RLS, add formula-injection escaping, run large exports as a BullMQ job that emails/links a file, and audit the export.

### WD-ASHELL-044 — Settings Delete workspace

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WSP
- **Summary:** The owner can delete the current workspace after typing its name and their password.
- **Actors & access:** workspace owner only (403 otherwise).
- **UX & screens:** danger card on the Data tab: input "Type the workspace name", input "Confirm with password", button "Delete workspace permanently", warning that it cannot be undone. Non-owners see "Only the workspace owner can delete the workspace."
- **Endpoints:**

| Method + uri                | Route name                        | Controller@action                       | Middleware | Request fields                                       | Response                                                                        |
| --------------------------- | --------------------------------- | --------------------------------------- | ---------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| DELETE `settings/workspace` | `user.settings.workspace.destroy` | SettingsTabsController@destroyWorkspace | auth       | `confirm_name` required, `current_password` required | redirect `/account` with success "Workspace deleted." or back with field errors |

- **Data:** `workspaces` row soft-deleted (`deleted_at`); audit `workspace_deleted` (info; meta workspace_id, name).
- **Rules & edge cases:**
  1. Order of checks: owner -> validation -> password (`Hash::check`, error "Wrong password.") -> exact trimmed name match (error "Workspace name does not match.").
  2. QUIRK: despite the copy "permanently delete", this is a soft delete; members' pivot rows, contacts, conversations, devices and running jobs are untouched, and only the plan-retention command (`workspaces:wipe-expired`, PLAN) ever purges data. The user's `current_workspace_id` is not cleared; the `currentWorkspace` accessor falls back to their first remaining workspace.
  3. Sessions of other members are not revoked; devices/bridge sessions are not disconnected.
  4. No plan gate, no cooling-off period, no email notice to members.
- **Async & events:** audit event only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the correct name and password, when submitted, then the workspace is soft-deleted, an audit row exists and the user lands on `/account` with the success flash.
  - Given a wrong password, when submitted, then nothing is deleted and the password error shows.
  - Given a name typed with different case, when submitted, then it fails (exact match).
- **Source refs:** app/Http/Controllers/SettingsTabsController.php (`destroyWorkspace`), app/Models/Workspace.php, app/Console/Commands/WipeExpiredWorkspaces.php.
- **Port notes:** WSP should own the teardown saga (disconnect channels, cancel jobs, revoke member access, schedule purge, notify members). Consider a 7-day grace period.

### WD-ASHELL-045 — Data residency toggle (on the DPA page)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** I18N
- **Summary:** On the "Data processing agreement" page the workspace owner restricts which translation providers may receive customer message text: no restriction, EU only, or on-premise only.
- **Actors & access:** page for any signed-in user; the form only renders for the owner. Plan flag `access_data_residency` exists on packages (gating enforced in translation code, not here).
- **UX & screens:** `resources/views/legal/data-processing.blade.php` (layout user, nav-key `more`): article-28 style page with a table of providers (MyMemory EU/Italy, Google unofficial global with no DPA, DeepL EU/Germany, Google Cloud Translation global, LibreTranslate self-hosted) and three radio options (No restriction / EU-only routing: DeepL and self-hosted only / On-premise only: LibreTranslate only) with Save.
- **Endpoints:**

| Method + uri                   | Route name                   | Controller@action                      | Middleware | Request fields                                   | Response                                                                                                          |
| ------------------------------ | ---------------------------- | -------------------------------------- | ---------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| GET `legal/data-processing`    | `user.legal.data-processing` | closure                                | auth       | none                                             | HTML                                                                                                              |
| POST `settings/data-residency` | `user.settings.residency`    | SettingsTabsController@updateResidency | auth       | `data_residency` required in `any,eu_only,local` | back with success "Data residency updated. Translation routing will respect the new setting on the next inbound." |

- **Data:** `workspaces.data_residency` (varchar(16), default `any`); audit `data_residency_changed` (info; workspace_id, value).
- **Rules & edge cases:** owner only (403); `TranslationProviderManager` reads the value at send time and silently skips incompatible providers; there is no link to this page from the Settings tabs (only from the legal route/other pages).
- **Async & events:** audit event.
- **External systems:** translation providers (I18N).
- **Settings:** admin translation providers (`admin/translation-providers`).
- **Acceptance criteria:**
  - Given the owner selects `eu_only` and saves, when auto-reply translation runs, then only DeepL and LibreTranslate are eligible.
  - Given an invalid value, when posted, then validation fails.
  - Given a non-owner, when the page renders, then the form is replaced by an owner-only note.
- **Source refs:** app/Http/Controllers/SettingsTabsController.php (`updateResidency`), resources/views/legal/data-processing.blade.php, routes/web.php (closure), app/Services/Translation/TranslationProviderManager.php.
- **Port notes:** keep the setting per tenant in the I18N/translation module; surface it under Settings > Data.

### WD-ASHELL-046 — Settings Appearance: personal theme preference

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-ASHELL-024
- **Summary:** A radio choice of Paper, Bright white or Dark (beta) saved to the user profile.
- **Actors & access:** any signed-in user (per-user; no owner check).
- **UX & screens:** Appearance pane with three theme cards and Save.
- **Endpoints:**

| Method + uri               | Route name                 | Controller@action                       | Middleware | Request fields                                     | Response                                |
| -------------------------- | -------------------------- | --------------------------------------- | ---------- | -------------------------------------------------- | --------------------------------------- |
| POST `settings/appearance` | `user.settings.appearance` | SettingsTabsController@updateAppearance | auth       | `theme_preference` required in `paper,bright,dark` | back with success "Appearance updated." |

- **Data:** `users.theme_preference` (varchar(16), default `paper`).
- **Rules & edge cases:**
  1. QUIRK: the server rejects `doodle` even though the header switcher offers it, and saving here does not set the `wa-theme` cookie that `Brand::activeTheme()` reads first, so the saved value only takes effect on browsers without that cookie.
  2. The Instaflow rail toggle posts the same endpoint (`theme_preference=paper|dark`, form-encoded, fire-and-forget).
  3. Tab description mentions fonts and density that do not exist.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a new browser with no cookie, when the user has saved `dark`, then the first page renders `data-theme=dark`.
  - Given `theme_preference=doodle`, when posted, then validation fails.
- **Source refs:** app/Http/Controllers/SettingsTabsController.php (`updateAppearance`), resources/views/user/settings/index.blade.php.
- **Port notes:** unify with the header switcher: one server-side preference, mirrored to a cookie on every change, all four themes.

### WD-ASHELL-047 — Unrouted admin prototype pages in AdminPagesController

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** none
- **Summary:** `AdminPagesController` and `UserPagesController` still contain view-only prototype actions that no route reaches. They document earlier static mock-ups and must not be ported.
- **Actors & access:** none (unreachable).
- **UX & screens:** none.
- **Endpoints:** none. AdminPagesController methods with no route: dashboard, users, userCreate, userEdit, userImport, userTrash, workspaces, workspaceCreate, workspaceDetail, billingHistory, billingAnalytics, orderHistory, orderAnalytics, invoices, invoiceView, coupons, support, supportSla, supportCustomers, supportPlaybooks, supportReports, teamInbox, announcements, guidebook, auditLog, security (their real pages moved to dedicated controllers). UserPagesController methods with no route: campaigns, campaignCreate, campaignEdit, flows, flowBuilder, devices, deviceDetail, autoReply, autoReplyCreate, autoReplyKeyword, scheduled, scheduledCreate, scheduledDetail, webhooks, webhookCreate, webhookDetail, metaAdsAnalytics, messageHistory, support, teamInbox, account.
- **Data:** none.
- **Rules & edge cases:** the sidebar source comment confirms Contacts / Meta Ads / Messaging / Platform admin mock-ups were deleted on purpose; two static helpers on AdminPagesController (`planFeatureToggles`, `planLimitColumns`) ARE still used by the package editor (PLAN).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the port backlog, when scoping the admin console, then none of the methods above are turned into features.
- **Source refs:** app/Http/Controllers/AdminPagesController.php, UserPagesController.php.
- **Port notes:** ignore.

## Data model

This domain owns no dedicated tables; it reads and writes shared tables. Behaviour-relevant columns:

**`users`** (AUTH owns the table)

- `theme_preference` varchar(16) NOT NULL default `paper` (values written: paper, bright, dark) - WD-ASHELL-024/046.
- `has_seen_intro` tinyint(1) default 0 - WD-ASHELL-023.
- `quick_access` json NULL - list of `{key}` or `{label,url}`, max 10 - WD-ASHELL-022.
- `auto_ai_summarize_enabled` tinyint(1) default 0 - WD-ASHELL-035.
- `current_workspace_id` bigint NULL - written by the switcher (WD-ASHELL-017).
- `inbox_last_seen_at` timestamp - read for "agents online" on /more (5 minute window).
- `role` varchar default `user` (legacy platform role, values `admin|A|user|...`), `locale` varchar(12), `avatar_path`, `wallet_credits` (shell reads for the wallet card), two-factor columns and sheets key columns (read/written in Settings tabs).

**`workspaces`** (WSP owns the table)

- `name`, `slug` (unique), `timezone` varchar(64) default UTC, `currency` varchar(10) NULL, `owner_user_id`, `status` tinyint default 1, `deleted_at` (soft delete), `trial_ends_at`, `plan_ends_at`, `plan` (slug or numeric id, dual-stored), `plan_overrides` JSON.
- Branding: `brand_primary|brand_accent|brand_background` varchar(16) NULL, `brand_logo_path` varchar(255), `brand_favicon_path` varchar(255), `brand_color` varchar(16) default `#075E54`.
- `notification_prefs` JSON (WD-ASHELL-038), `data_residency` varchar(16) default `any` (WD-ASHELL-045).

**`system_settings`** (SET owns the table): `id`, `key` varchar(96) UNIQUE, `type` varchar(16) default `int`, `value` text, `description`, timestamps. Keys used by this domain:

- Shell: `user_dashboard_layout` (topbar|sidebar), `user_sidebar_color`, `user_sidebar_text_color`, `user_sidebar_accent_color`, `user_nav_order` (json `{bar:[...]}`), `ti_pwa_enabled`.
- Theme: `theme.color.<token>` x16, `theme.metric.font-scale|ui-opacity`.
- Availability flags: `facebook_enabled`, `tiktok_enabled`, `telegram_enabled`, `sms_enabled`, `line_enabled`, `wechat_enabled`, `viber_enabled`, `email_enabled`, `instagram_enabled`.
- Admin gate: `security.ip_allowlist_enabled`, `security.ip_allowlist_cidrs`.
- Read for wallet/brand: `credits_per_message`, `default_currency`, `app_name`, `brand.favicon`, logos.

**`ai_provider_keys`** (AIADM owns): (workspace_id, provider) unique; api_key encrypted; is_active. Written by WD-ASHELL-039.

**`announcements`** (CMS owns): read by the announcement bar; cached 60 s.

**`sessions`**: read/deleted by WD-ASHELL-041 (columns id, user_id, ip_address, user_agent, payload, last_activity; indexes on user_id and last_activity).

**`impersonation_sessions`** (WSP owns): read by the banner and membership guard.

Browser-side state: `localStorage` keys `wa-theme`, `wd_rail_collapsed`, `qadHandleTop`, `ibx-bell-pos`, `wadesk:more-page-shortcuts:v1:ws<id>`, `wadesk:list-grid:<key>`, `dismissed:ann-<ids>`; `sessionStorage` keys `wd_rail_scroll`, `ibx-bell-dismissed`; cookies `wa_admin_sidebar`, `wa-theme`.

## Cross-domain contracts

- **Consumes AUTH:** `logout` POST route and a `#logoutForm`; login redirect to `/home`; `Force2FA` for enrolled users; the credential model for 2FA and sessions tables.
- **Consumes WSP:** `workspaces.switch`, `workspaces.create`, `workspaces.select`, workspace membership guard, `{wsSlug}` slug landing, `ImpersonationBanner`, `ResolveTenantDomain` (`$isTenantDomain`), `User::switchWorkspace/workspaceRole/canCreateWorkspace`.
- **Consumes RBAC:** workspace role hierarchy (`WorkspacePermissions::HIERARCHY`), platform roles (`PlatformPermissions`), `isAdmin()`.
- **Consumes PLAN:** `PlanLimitGuard::hasFeature`, `Workspace::onTrial/billingPackage/package`, `Subscription`, `config/plan_gates.php`, feature keys, `workspaces_per_owner_limit`, `user_seat_limit`, `allow_byok_ai_keys`, `ai_token_limit_monthly`, checkout and plans routes.
- **Consumes NOTIF:** bell feeds (`user.notifications.*`, `admin.notifications.*`), `NotificationHelper` uses `workspaces.notification_prefs`.
- **Consumes TIB1:** `GET team-inbox/api/unread-summary`, `/team-inbox`, `/team-inbox/members`.
- **Consumes WADEV/WABA:** `WorkspaceEngine` (engine and connected WABA rows), `/devices?embed=1` and its postMessage contract.
- **Consumes ADD:** `ExtensionRegistry::nav('admin')` (and `routeFiles`) for admin nav items and extension routes.
- **Consumes CMS:** `Announcement` model and admin announcements CRUD; frontend layout is separate.
- **Consumes SET/I18N:** brand name/logos/favicon, SEO/PWA/analytics/cookie-consent partials, `LocaleSettings::directionFor`, locale switcher component and `POST locale`.
- **Consumes DASH:** `/dashboard`, `/analytics`, `/admin`, `/admin/analytics`, `/admin/financial`, `/admin/premium`, `/admin/ai-dashboard`, `/admin/health` are nav targets; the dashboard hosts the `data-tour` anchors and the Quick-access section markup.
- **Exposes:** the shared nav catalogue (topbar, rail, More, quick-access, palette) to every feature domain (each domain contributes its nav entries with `minRole`, `featureKey`, `channelGate`); `UserNav::layout()`/`groups()`; `QuickAccess` (per-user shortcuts); `theme_css()` tokens and `themeColor()` JS helpers to every chart/domain; the `hideHeader` layout option; global JS helpers (`window.toast`, `WaToaster`, `uiConfirm`, `WaProgress`, `openConnectDevice`, `wadeskStartTour`); session flash conventions (`success|status|error|warning`); system settings `user_dashboard_layout`, `user_nav_order`, `theme.*`.

## Open questions & quirks

**Routes left to other domains (not claimed here):**

- `AdminPagesController` (84 routes; I claim only `GET admin/settings`, `GET/POST admin/settings/menu-order`). Left: `GET admin/analytics` (DASH); `admin/devices*` x7 (WADEV); `admin/packages*` x9 incl. analytics export (PLAN); `POST admin/workspaces/{id}/overrides` (PLAN/WSP); `GET admin/users/import/template` (AUTH/RBAC); `GET manifest.json` (SET, PWA); the entire `admin/settings/*` leaf pages: general, mail(+test), message, message-rates(+import,+sync-meta), wallet-rules, providers, channel-setting(+node, +node/test, +pacing, +otp-template, +coexistence check/subscribe), affiliate, analytics, auth-pages(+preview, +variant, +inline, +inline-media, +inline-media-clear), catalog, custom, footer, seo, privacy, pwa(+generate-keys), social-login, mobile-push, integration, shopify, woocommerce, hubspot, slack, trello, google-calendar, export (SET, WALLET, WABA, WADEV, AUTH, CMS, CAT, ECOM, INTG, PAYGW as appropriate).
- `UserPagesController`: `dashboard`, `analytics`, `analytics/export` (DASH); `connect` (WADEV); `integrations` (INTG); `guidebook`, `guidebook/{slug}`, `guidebook/{slug}/vote` (SUPP/CMS, matches the admin Guidebook module); `notifications-page` (NOTIF).
- Closures: `GET csrf-token` (AUTH/CORE), `GET {wsSlug}` (WSP), `GET admin/bsp/rate-cards` (BSP), `GET up` and `*/_health` (CORE), `GET/PUT storage/{path}` (SET), and all other closure routes belong to their channel/domain owners.
- Middleware left to others: `EnsureTrialActive`, `EnsureUserActive`, `SetLocale`, `Maintenance`, `DemoMode`, `SessionTimeout`, `LimitConcurrentSessions`, `NoStoreResponse`, `ResolveTenantDomain`, `Force2FA`, etc.
- Admin pages with NO navigation entry anywhere in the sidebar or Settings hub: Credit packages, Translation usage, Meta Ads keys, Pricing FAQs (linked only from Billing settings), BSP rate cards, `/admin/team-inbox` (only the impersonation redirect target). Confirm intended reachability in the port.

**Quirks (each also noted in the features above):**

1. Agents and viewers get an empty nav in both shell modes (no item is tier `agent`); managers do not see Unified Inbox or More in topbar mode. Comment in source claims otherwise.
2. Menu editor defaults differ from the real header defaults (Meta Ads vs Unified Inbox); saving untouched swaps them for everyone. Nine CRM items in the header catalogue can never be promoted by the editor.
3. `Route::has('checkout.show')` is always false (real name `user.checkout.show`), so "Renew now" never deep-links to checkout.
4. Header gear (Platform Support/Auditor allowed) vs admin route gate (Super Admin/Admin only) disagree.
5. Sidebar background colour always posts a value, so the rail stops following the theme after the first Appearance save.
6. Header theme switcher never persists server-side; Settings > Appearance rejects `doodle`, does not set the cookie that wins on render.
7. Quick access: `//host` URLs pass validation; saving an empty list silently restores the defaults.
8. `data-tour-replay` has no trigger in any view; tour steps depend on DOM presence, which drops most steps in sidebar mode and by default for Meta Ads.
9. The global palette index is static, ignores role/plan/channels and even lists admin pages to everyone; the injected admin search box is decorative; Ctrl/Cmd+K is bound twice in sidebar mode.
10. Data export scopes contacts by member user ids; delete workspace is a soft delete with untouched children; 2FA QR is fetched from a third-party host; AI key provider slug is not whitelisted; the "leave blank to keep" placeholder conflicts with `required`.
11. Inbox bell and profile menu ignore the sub-folder base path in places (`/team-inbox/api/unread-summary` hard-coded) while `wurl()` handles it elsewhere.
12. Admin sidebar runs about 20 uncached COUNT queries and `/more` about 40 per request.
13. The workspace branding favicon is stored but never used; the sidebar rail ignores the workspace logo.
14. Docs advertise `/admin/appearance` and an Appearance sidebar item; real route is `/admin/settings/appearance` and it is only a hub tile. The docs' dashboard pages describe DASH behaviour, not shell behaviour.
15. `Working hours` card and the AI-key "test" helper are UI-only (docs-only/dead).

**Open questions:**

- Which pages should `Platform Support` and `Auditor` roles reach in the port (the seeded permission matrix implies read-only admin access)?
- Should the sidebar/topbar ever hide plan-locked items for agents (WaDesk only locks)?
- Is the `menu-order` setting still desired once a role-aware nav exists?
- Where do the `theme_preference` cookie/DB split and per-user layout choice belong (this domain vs I18N/SET)?

## Coverage

```json wadesk-coverage
{
  "routes": [
    "GET home",
    "GET admin/settings",
    "GET admin/settings/menu-order",
    "POST admin/settings/menu-order",
    "GET admin/settings/appearance",
    "POST admin/settings/appearance",
    "POST admin/settings/appearance/reset",
    "GET more",
    "GET settings",
    "POST settings",
    "POST settings/2fa/disable",
    "POST settings/2fa/enable",
    "POST settings/aikeys/{provider}",
    "DELETE settings/aikeys/{provider}",
    "POST settings/appearance",
    "POST settings/branding",
    "POST settings/data-residency",
    "GET settings/export/{type}",
    "POST settings/notifications",
    "POST settings/preferences",
    "POST settings/sessions/revoke-others",
    "DELETE settings/sessions/{id}",
    "DELETE settings/workspace",
    "POST quick-access",
    "POST tour/seen",
    "GET legal/data-processing"
  ],
  "controllers": [
    "app/Http/Controllers/AdminPagesController.php",
    "app/Http/Controllers/UserPagesController.php",
    "app/Http/Controllers/SettingsTabsController.php",
    "app/Http/Controllers/QuickAccessController.php",
    "app/Http/Controllers/Admin/AppearanceController.php"
  ],
  "services": [
    "app/Support/UserNav.php",
    "app/Support/QuickAccess.php",
    "app/Support/fc_helpers.php",
    "app/Support/Brand.php"
  ],
  "models": [],
  "tables": [],
  "views": [
    "resources/views/components/layouts/admin.blade.php",
    "resources/views/components/layouts/user.blade.php",
    "resources/views/components/admin/flash.blade.php",
    "resources/views/components/admin/header-right.blade.php",
    "resources/views/components/admin/sidebar.blade.php",
    "resources/views/components/user/connect-device-sheet.blade.php",
    "resources/views/components/user/header.blade.php",
    "resources/views/components/user/inbox-bell.blade.php",
    "resources/views/components/user/quick-access-drawer.blade.php",
    "resources/views/components/user/quick-access-modal.blade.php",
    "resources/views/components/user/sidebar-rail.blade.php",
    "resources/views/components/user/topstrip.blade.php",
    "resources/views/components/announcement-bar.blade.php",
    "resources/views/components/trial-bar.blade.php",
    "resources/views/components/plan-crown.blade.php",
    "resources/views/components/plan-paywall.blade.php",
    "resources/views/components/theme-bootstrap.blade.php",
    "resources/views/components/confirm-modal.blade.php",
    "resources/views/components/info-hint.blade.php",
    "resources/views/components/skeleton.blade.php",
    "resources/views/components/side-tip.blade.php",
    "resources/views/components/list-grid-toggle.blade.php",
    "resources/views/partials/app-font.blade.php",
    "resources/views/partials/js-i18n.blade.php",
    "resources/views/admin/settings/index.blade.php",
    "resources/views/admin/settings/menu-order.blade.php",
    "resources/views/admin/settings/_menu_chip.blade.php",
    "resources/views/admin/settings/appearance.blade.php",
    "resources/views/user/more/index.blade.php",
    "resources/views/user/settings/index.blade.php",
    "resources/views/legal/data-processing.blade.php"
  ],
  "commands": [],
  "permissions": [],
  "middleware": [
    "app/Http/Middleware/EnsureUserIsAdmin.php",
    "app/Http/Middleware/IPAllowlist.php",
    "app/Http/Middleware/EnsureWorkspaceRole.php",
    "app/Http/Middleware/ImpersonationBanner.php"
  ],
  "node_files": [],
  "js_assets": [
    "resources/js/admin-sidebar.js",
    "resources/js/theme-colors.js",
    "resources/js/tour/guided-tour.js",
    "resources/js/wadesk.js",
    "resources/js/app.js",
    "resources/js/wa-toaster.js",
    "resources/js/list-grid-toggle.js",
    "resources/js/lib/ui-modal.js",
    "resources/js/lib/info-hint.js",
    "resources/js/charts/user-more-index.js",
    "resources/js/charts/user-settings-index.js",
    "resources/js/charts/admin-settings-appearance.js"
  ],
  "misc_files": [],
  "config_files": ["config/plan_gates.php"],
  "doc_pages": [
    "Documentation/pages/getting-started/dashboard.html",
    "Documentation/pages/admin-panel/dashboard.html",
    "Documentation/pages/admin-panel/appearance.html"
  ],
  "feature_map": {
    "WD-ASHELL-001": ["GET home"],
    "WD-ASHELL-002": [],
    "WD-ASHELL-003": [],
    "WD-ASHELL-004": [],
    "WD-ASHELL-005": [],
    "WD-ASHELL-006": [],
    "WD-ASHELL-007": [],
    "WD-ASHELL-008": ["GET admin/settings"],
    "WD-ASHELL-009": ["GET admin/settings/menu-order", "POST admin/settings/menu-order"],
    "WD-ASHELL-010": [
      "GET admin/settings/appearance",
      "POST admin/settings/appearance",
      "POST admin/settings/appearance/reset"
    ],
    "WD-ASHELL-011": ["POST admin/settings/appearance"],
    "WD-ASHELL-012": [],
    "WD-ASHELL-013": [],
    "WD-ASHELL-014": [],
    "WD-ASHELL-015": [],
    "WD-ASHELL-016": [],
    "WD-ASHELL-017": [],
    "WD-ASHELL-018": [],
    "WD-ASHELL-019": [],
    "WD-ASHELL-020": ["GET more"],
    "WD-ASHELL-021": [],
    "WD-ASHELL-022": ["POST quick-access"],
    "WD-ASHELL-023": ["POST tour/seen"],
    "WD-ASHELL-024": [],
    "WD-ASHELL-025": [],
    "WD-ASHELL-026": [],
    "WD-ASHELL-027": [],
    "WD-ASHELL-028": [],
    "WD-ASHELL-029": [],
    "WD-ASHELL-030": [],
    "WD-ASHELL-031": [],
    "WD-ASHELL-032": ["GET settings"],
    "WD-ASHELL-033": ["POST settings"],
    "WD-ASHELL-034": [],
    "WD-ASHELL-035": ["POST settings/preferences"],
    "WD-ASHELL-036": ["POST settings/branding"],
    "WD-ASHELL-037": [],
    "WD-ASHELL-038": ["POST settings/notifications"],
    "WD-ASHELL-039": ["POST settings/aikeys/{provider}", "DELETE settings/aikeys/{provider}"],
    "WD-ASHELL-040": ["POST settings/2fa/enable", "POST settings/2fa/disable"],
    "WD-ASHELL-041": ["DELETE settings/sessions/{id}", "POST settings/sessions/revoke-others"],
    "WD-ASHELL-042": [],
    "WD-ASHELL-043": ["GET settings/export/{type}"],
    "WD-ASHELL-044": ["DELETE settings/workspace"],
    "WD-ASHELL-045": ["GET legal/data-processing", "POST settings/data-residency"],
    "WD-ASHELL-046": ["POST settings/appearance"],
    "WD-ASHELL-047": []
  }
}
```
