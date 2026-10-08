# Parity evidence: admin console and app shell

Reference 1.7.0 vs this working tree (not committed). Scope so far: the platform-console rail, TW-ASHELL-003 (layout), 004 (grouped
navigation with live counts), 005 (collapse, group toggles, phone drawer) and the console part of 019 (the Ctrl/Cmd+K search). The customer shell, header controls, settings hub
and the rest of the domain are not built yet, and are not covered here.

## Evidence

| What                                              | Where                                                                                          | Result                                                                                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation logic and count formatting (unit)      | `apps/web/src/features/admin-console-shell/*.test.ts`                                          | 91 tests pass (menu layout and coverage, search, nav, sidebar)                                                                        |
| Rail and search in a real browser (our app alone) | `apps/web/e2e/admin-console-shell/shell.spec.ts`, `pnpm --filter @crm/web test:e2e`            | 29 of 30 pass; the gated-admin test needs a super admin without two-factor, and the local one has it                                  |
| Twin run, same scenarios on Reference and on ours    | `apps/web/e2e/admin-console-shell/parity/TW-ASHELL-005.twin.mjs`, depth quick, 3 scenarios     | PASS before the menu redesign. **Not re-run since**: the reference was not running; see below                                         |
| Menu areas and left menu (unit)                   | `apps/web/src/features/admin-console-shell/*.test.ts`                                          | 172 tests pass in the shell and module-nav folders: hub placement, 12-hub and 9-tab caps, role table, route coverage, en and ar names |
| Menu hubs in a real browser                       | `apps/web/e2e/admin-console-shell/shell.spec.ts` (rewritten for Home blocks and the left menu) | **Not run.** Updated and typechecked only: the stack could not be started in the session that wrote it                                |
| Twin run for the hub menu                         | n/a                                                                                            | **Not run** (reference app not running). The menu layout differs on purpose, see differences 10 to 15                                 |
| Typecheck, lint                                   | `pnpm --filter @crm/web typecheck lint`                                                        | clean                                                                                                                                 |

## Rows (twin run)

| #   | Criterion / UX item                                                           | Reference observed                             | Ours observed                                          | Result |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------ | ------ |
| 1   | A guest opening the console is sent to a sign-in page, and sees no console UI | redirected; no console toggle on the page   | redirected; no console toggle on the page              | same   |
| 2   | The rail collapses to icons, remembers it in a cookie, survives a reload      | collapses to about 76 px; cookie set; stays | collapses to 64 px; cookie set; stays; server-rendered | same   |
| 3   | Expanding again restores the full width                                       | restores                                    | restores                                               | same   |
| 4   | On a phone the rail is off-screen and its collapse button is not on screen    | off-canvas at x = -260                      | hidden; collapse button not rendered                   | same   |
| 5   | The page does not scroll sideways on a phone                                  | no overflow                                 | no overflow                                            | same   |

## Intended differences

| #   | Area                    | Reference                                                                                                                                 | Here                                                                                                                                                                                                    | Why                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Count format            | Inventory said 12,500 reads `12.5k`                                                                                                    | Reads `13k`                                                                                                                                                                                             | Verified on the running Reference: no decimals from 10,000. The inventory example was wrong and is corrected                                                                                                                                                                                                                                                             |
| 2   | Collapsed width         | about 76 px                                                                                                                            | 64 px                                                                                                                                                                                                   | Design-system spacing step; behaviour is the same                                                                                                                                                                                                                                                                                                                     |
| 3   | Menu contents           | About 40 entries, all fixed in code                                                                                                    | Only pages that exist today; each domain adds its own                                                                                                                                                   | Linking to unbuilt pages would 404; entries arrive through the nav data                                                                                                                                                                                                                                                                                               |
| 4   | Icons                   | Per-item icons                                                                                                                         | An icon per section, Overview and Your account; pages are text only                                                                                                                                     | Per-item icons on 69 rows were the clutter. Uses the shared menu icon set, plus five drawn locally (shield, tag, globe, modules, user)                                                                                                                                                                                                                                |
| 5   | Menu grouping and order | Overview, five dashboards at top level, then Users and access, Billing and plans, Support, Marketing and so on (about 8 groups)        | Nine sections by job: Insights, Plans and pricing, Billing and revenue, Support and website, Channels and messaging, Apps and modules, Access and security, Platform settings, System and localization  | Requested by the project owner (2026-10-04): the rail had 21 headings for 69 pages, two of them both named "System" and seven holding a single page, because each ported domain added its own. Every page keeps its address; `console-layout.test.ts` fails if a page is missing, duplicated or left unplaced, and an unplaced page still shows under its own heading |
| 6   | Long sections           | One flat list per group (Platform settings 17, Billing 12)                                                                             | Small headings inside a section (for example Orders and invoices, Payments, Messaging and wallets)                                                                                                      | Same reason; the headings are not links and add no page                                                                                                                                                                                                                                                                                                               |
| 7   | Collapsed rail          | Icon per entry                                                                                                                         | One icon per section; choosing one opens the rail on that section                                                                                                                                       | 69 near-identical icons cannot be told apart; the cookie, width and phone behaviour are unchanged                                                                                                                                                                                                                                                                     |
| 8   | Scrolling               | The whole rail scrolls                                                                                                                 | Only the menu list scrolls; the brand row and Your account stay in view                                                                                                                                 | Long open sections pushed the account link out of sight                                                                                                                                                                                                                                                                                                               |
| 9   | Page moves              | Billing and plans held Packages, Add-ons, Coupons; Support held Inbox and Contact inbox; AI Dashboard and System Health were top level | Add-ons (billing) and Coupons sit in Plans and pricing; Contact inbox sits with the Support inbox; AI usage and System health are in Insights; AI provider keys and Menu order are in Platform settings | Follows Reference grouping where the port had drifted from it, and puts each page where an operator looks for it                                                                                                                                                                                                                                                         |

| 10 | Menu structure (supersedes 5 to 7) | Overview plus about 8 groups of up to 12 entries; Settings is one entry that opens a hub | Home is a grid of 11 area blocks (icon, name, one line, page count) with no left rail; opening an area puts its pages in a menu on the left, under small group headings where the area is long (Settings, Team and security), with All areas and an area switcher at the top. The collapsed rail shows one icon per area. Settings keeps its overview page of tiles as the first page of its menu | The rail held 80 entries and repeated the same list in four places (rail, Overview cards, Settings tiles, search). Requested by the project owner (2026-10-07). Every page keeps its address; nothing is merged or removed. Spec: `docs/specs/admin-menu-hubs.md` |
| 11 | Home page | A KPI dashboard (owned by the dashboards domain) | "Needs attention" (health and unread notifications, from the sources the header already polls) plus one card per hub | The old landing page was the menu reprinted as cards. The KPI tiles still belong to the dashboards domain and are not part of this change |
| 12 | Pages that had no entry | Flow templates is in the menu; the wallet overview has no entry | Flow templates is a page of Apps; the wallet overview is the first page of Messaging billing | Both were built and unreachable from the menu. A route-coverage test now fails if a built admin page is neither in a hub nor on the `NOT_IN_MENU` list |
| 13 | Clashing names | "Add-ons" meant billing packs and installable code; "Analytics" meant a report and tracking code; two "settings" pages read alike | Add-on packs, Extensions, Tracking code, Plan pricing settings, Checkout settings | One meaning per name. Said once in the shell's message file; no other domain's file is touched |
| 14 | Search labels | Entries show their group | Every page is found and labelled with its area and group | Most pages are not on Home, so search is the fast path to any page |
| 15 | Pages hidden by role | Every operator sees every entry | Five pages are hidden from roles whose API is closed to them: plan analytics, financial and premium (super admin only), AI keys and webhook forwarding (super admin only), platform analytics (not support) | Only pages whose controller carries the role guard on the whole class are listed (`console-access.ts`). Most operator controllers guard writes only, so most pages stay visible to every role and show read-only controls. Pages gated by finer permission keys still show their no-access page: the session carries the role, not the keys |

## TW-ASHELL-019: the console search (Ctrl/Cmd+K)

The Reference palette is client-only, with a hard-coded index of 56 entries (mostly customer pages) and hidden keywords per entry. The console version
is the same palette fed by the console menu, as the inventory port note says. Checked against the inventory entry and the reference source
(`resources/js/threadwise.js`), and in our own browser spec; **not** compared side by side on the running reference.

| #   | Behaviour (TW-ASHELL-019)                                              | Ours                                                                                       | Result |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------ |
| 1   | Ctrl/Cmd+K opens it on every page, field focused; the same keys toggle | Same, also on non-Latin keyboard layouts (matches the K key position)                      | same   |
| 2   | Empty field lists the first 8 entries                                  | The first 8 pages of the menu                                                              | same   |
| 3   | A query matches name, description and hidden keywords, at most 12      | Name, section, block, hidden keywords and address words; every word must match; at most 12 | same   |
| 4   | Footer hints: up/down navigate, Enter open, Cmd K toggle               | Same                                                                                       | same   |
| 5   | Escape closes; a click outside closes                                  | Same; on a phone Escape closes only the search, not the menu drawer behind it              | same   |
| 6   | Empty state "No results for ..."                                       | Same wording                                                                               | same   |
| 7   | A keyword finds a page its name does not (Reference: "roas")              | "stripe" finds Payment gateways, "smtp" finds Mail, "openai" finds AI provider keys        | same   |

| #   | Area        | Reference                                                                                              | Here                                                           | Why                                                                                           |
| --- | ----------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 10  | Index       | 56 customer-app entries plus 6 admin ones, not filtered by role                                     | Every page of the console menu, plus Your account              | The inventory port note: feed it from the menu. The console is where the operator is          |
| 11  | Placeholder | "Search pages, contacts, templates, settings..." although no entity search exists (inventory QUIRK) | "Search pages and settings..."                                 | The promise was false; there is no contact or template search to offer                        |
| 12  | Result row  | A tag chip (page, account, plan, help, system) and a description                                    | The section and block the page sits in                         | The chips do not map onto console pages; the location tells the operator where they are going |
| 13  | Header box  | A decorative "Search admin..." box that does nothing (inventory QUIRK)                              | The same box opens the search; on a phone a search button does | A box that looks like a field and does nothing is a defect; a phone has no keyboard shortcut  |
| 14  | Keywords    | One list per entry                                                                                  | English words per page in `console-keywords.ts`                | Other languages search by the translated name and section, plus the English keywords          |

## Not done yet (honest list)

- **The twin run was not repeated after the redesign and the search.** The Reference reference was not running, and the run needs the pinned harness (and a Chromium build Playwright 1.60 expects) installed. A twin run now compares a menu that differs from Reference on purpose, so the rows in "Intended differences" above need the domain owner's approval first. The previous stamp does not cover the current files.
- **Console search, not done:** the customer-app index entries, the Logout entry and the profile menu from TW-ASHELL-019 (they belong to the customer shell, not started).
- **Search while two-factor enrolment is pending:** the menu is disabled then, so the search is disabled too. The e2e test for the gated admin could not run here (the local super admin already has two-factor), so that case is covered by the code path only.

- **Counts:** Reference shows badges for users, roles, permissions, devices, workspaces, coupons and more. Ours shows only the plan count, because that is the only source behind the operator API today. Cross-tenant counts need a sanctioned platform read (a decision for the kernel steward), so none was added.
- **Header controls (TW-ASHELL-006):** health pill, notification bell, account menu with role and email. The theme and language switchers exist; the rest does not.
- **Toasts (TW-ASHELL-007):** the existing toast supports success and error; the warning variant of Reference's inline banner is not added.
- **IP allowlist on the console (TW-ASHELL-002):** already enforced by AUTH's `OperatorGuard` on every operator API call; no separate console check was added.
- **Customer shell, quick access, tour, workspace switcher, settings hub (008 to 047):** not started.
- **Twin run depth:** only `quick`, three custom scenarios. The harness's page probes (accessibility, keyboard, degraded states, performance) were not run on the console because its default login is the staff login, not the operator login. Our own Playwright spec covers keyboard and phone behaviour.
- **Environment:** Reference ran from a Windows bind mount in Docker, with cold pages taking several seconds; the twin spec uses long timeouts for it.
- **Tracker and stamp:** the tracker rows were not changed (these domains are listed under another owner in `ownership.json`, which needs the team's approval to change).

## Round 2 status (supersedes the "Not done yet" list above where they differ)

Built and tested on this branch (unit, API e2e against a real database, web unit): 003 to 005, 006, 009, 012 to 016, 019 to 023, 026, 028, 029,
032, 033, 035, 038, 042 (informational pane), 043, 044, 046. Gates run: API unit 38, API e2e 44 (4 files), web 3383 (318 files), arch:check,
db:verify-schema (0 errors), eslint on the zone.

tier P0 done: 012, 013, 014 (customer shell modes, top bar, rail catalogue) on top of the AUTH/PLAN work (001, 002, 017 are theirs).
tier P1 done: 005, 006, 009, 015, 016, 019, 020, 026, 028, 029, 032, 033, 038, 043, 044.
tier P2 done: 021, 022, 023, 035, 042 (partial), 046.

Delivered by another domain, consumed here: 010 and 011 (the platform Appearance editor lives in platform-settings; the shell reads mode and rail colours
through `/v2/shell/config`), 024 (header theme switcher, one cookie), 027 (PlanPaywall and the crown on gated menu entries), 031 (the @crm/ui kit),
036 (account branding page), 037 (settings/team), 039 (ai-keys), 040 and 041 (account/security); the Settings rail links to these pages.
007: the warning variant is the `@crm/ui` Alert tone; toasts stay success and danger (Reference's toast also ignored warning).

Not built, with reasons: 030 impersonation strip (blocked: no impersonation session exists in AUTH or WSP yet), 025 workspace white-label colours in
the shell and 036 logo and favicon upload in the shell (blocked on the branding storage endpoints of platform-settings), 008 admin settings hub KPI strip
(the hub itself is the platform-settings page), 045 data residency toggle (needs the i18n translation settings, blocked on that domain), 042's Sheets key
status and webhook counts (blocked on the integration modules). Not ported on purpose: 034 working hours card (docs-only, static), 047 unrouted
prototype pages (dead code).

## Intended differences added in round 2

| #   | Area                 | Reference                                              | Here                                                          | Why                                                                            |
| --- | -------------------- | --------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 5   | Settings tabs        | Nine panes swapped client-side on one page          | Rail of nine; four tabs link to the page that owns them       | Each already has its own route in another domain (inventory port notes agree)  |
| 6   | Themes               | Paper, bright, doodle, dark; two stores that differ | Light and dark; one cookie shared by header and Settings      | The design system ships two themes; removes Reference's disagreement (046 quirk)  |
| 7   | Connect-device sheet | Accepted a message from any window                  | Accepts only this origin and only the sheet's own frame       | Security hardening; behaviour for the real page is unchanged                   |
| 8   | New-message pill     | Polled with a fixed interval                        | Backs off after a 429 or error up to 5 minutes, pauses hidden | Keeps load down on a throttled API; the normal interval is the same 15 seconds |

Live visual twin comparison was not repeated in round 2 (Reference was shared and slow); layout was matched from the Blade views and recorded above.

## Round 3: conformance pass against the running Reference (top bar, sidebar, account menu, flash)

Compared live (Reference 1.7.0 at 127.0.0.1:8000 against this app, 1360 px, top bar mode and sidebar mode): dashboard header, notification
bell, theme menu, account menu, workspace pill, rail, top strip, More hub, tour step 1. Fixed in this round:

- Top bar: round hairline controls in Reference's order (search, theme, language, page-settings gear, bell, avatar with chevron); no balance chip (Reference
  keeps balance in the account menu and the rail's wallet card); serif brand; workspace pill (round avatar, name, no plan line); bar labels are Reference's
  ("Unified Inbox", "Channels"); Channels uses the network glyph. The page-settings gear now shows in the top bar and the strip (TW-SET gear).
- Account menu (TW-ASHELL-019): avatar, name, mono email, green "plan . role" chip, Profile, Wallet with balance, Order history, Settings, Pricing and
  plans, Help and support, Log out, app-name footer. Language and theme moved out of the menu into the header, as in Reference.
- Sidebar mode: strip is breadcrumb, jump box with the Cmd-K hint, centred greeting and clock, language, theme, bell, name and role. The rail is open by
  default (Reference's rail is always 260 px), brand with the "Console" caption, workspace card on top, collapsible groups remembered in the browser (the
  group holding the page stays open), accent bar on the active entry, wallet card with Top up at the foot. Group names are Reference's.
- TW-ASHELL-007 flash: `features/admin-console-shell/flash` (store, host, tests) is the shell's flash, with success, info, warning and danger; the
  dashboard's role bounce (TW-DASH-001) raises "Your role (x) doesn't have access to that page" on it.
- Quick access: the header and the edge drawer use the shell's `admin-console-shell/quick-access` (TW-ASHELL-022). The dashboard's own tiles
  (`DASH_QUICK_ACCESS_*` exports, `dashboards-analytics-charts`) are the dashboard card that Reference also has; both read the same user list, neither
  was deleted.
- TW-SET-016 (menu layout editor) is the same feature as TW-ASHELL-009 and is built there (`admin/settings/menu-order`, API and tests).
- Announcement bars: the app layout still mounts the shell's `AnnouncementBars`, not the CMS bar.

Intended differences added: theme menu offers light and dark (Reference four themes); header stays sticky (Reference's scrolls away); "Take the tour" row kept
in the account menu (Reference's own port notes ask for a replay entry); Reference quirk not reproduced: saving its Appearance form always forces a dark rail
(colour input cannot post blank), here no colour means the theme's rail.

Not done in this round, with the reason: the More hub (TW-ASHELL-020) is still a plain tool list. Reference's has a four-figure live strip, illustrated tool
cards with usage footers, and a side column (recent activity, affiliate, plan, tips, what's new); this needs counters from several domains and was not
rebuilt. Also not compared screen by screen: command palette, quick access editor, tour steps 2 to 11, announcement bars, connect-device sheet, the
workspace settings tabs. Not rebuilt: 008, 025, 030, 036 (blocked as before), 045.

Tests: web 4116 passed (384 files); `pnpm arch:check` fails on existing chat-conversations and flow-runtime-engine violations, none in this domain.

## Round 4: blocked features re-attempted, More hub, bell, conformance

tier P1 done (round 4): 008 (settings hub tile search), 018 (bell: Inbox eyebrow, serif title, Clear all and View all footer), 020 (More hub rebuilt).
tier P2 done (round 4): 025 and 036 (workspace Branding tab and white-label shell), 042 (Sheets key status and webhook counts), 045 (data residency).

- 036/025: owner-only Branding tab (`GET/POST /v2/shell/workspace/branding`, multipart). Colours live in `organizations.settings.branding`; logo and favicon bytes in the new tenant table
  `workspace_brand_assets` (migration `20261025090000_ashell_workspace_brand_assets`, forced RLS). The shell applies colours as CSS variables, the logo in the top bar, and the favicon (Reference never applied it).
  Tests: `apps/api/test/e2e/admin-console-shell/branding.e2e.spec.ts` (owner only, blank clears, absent untouched, #RRGGBB, SVG and fake images refused, one row per slot, tenant isolation) and `brand-css.test.ts`.
- 045: `GET/PUT /v2/shell/workspace/data-residency` writes `workspace_settings.data_residency`, the column the translation router reads; the form is on Settings > Data (the DPA page, owned by CMS, shows the current mode).
- 042: `GET /v2/shell/workspace/integrations` (my Sheets key suffix and times, never the hash; outbound and inbound webhook counts).
- 018: `DELETE /v2/shell/notifications` (my notifications only, audited). The NOTIF module had no delete. ONE edit in `features/notifications-activity-audit/components/notification-bell.tsx`.
- 008: the hub, KPI strip and quick buttons were already the SET page; added Reference's tile search (one edit in `platform-settings-branding-storage/components/settings-hub.tsx`).
- 020: `GET /v2/shell/overview-stats` (one read per page, one savepoint per figure). The page has the live strip, Reference's 40 tool cards (shown only when our screen exists) with live footers, Navigation strip, tabs, and the side column.
- Compared live with Reference (1360 px): More hub, Settings General and Branding. Fixed: rail card with icons and filled active pill, serif card titles, mono "Personal" card, dropzone icons.

Intended differences added: Branding stores bytes in the database (interim, like the avatar) and accepts raster images only (SVG can carry script; Reference's `image` rule refused it in practice); colours are sent only when edited, so saving a logo never repaints with the defaults; the page background colour applies to the light theme only; residency form lives in Settings > Data; More hub cards for tools whose page does not exist here (Meta Ads, SMS, LINE, WeChat, Viber, TikTok, Quick Send, Lead Finder, Auto Reply, Message History, Notifications page, Google account, Call Logs, Forms, Link Generator, AI Training, Webhooks, Activity Log) appear automatically when the owning domain adds the screen; Settings tiles are not repeated in the grid; recent activity reads `audit_log` (module and action) because security events are privileged-only; AI Training shows assistants only; Connected counts devices only; Developers / API opens Settings > API and webhooks.

Still blocked: 030 impersonation strip. Nothing mints an impersonation session: `PlatformInboxService.impersonate` (platform-support-desk) answers 501 and no module writes `impersonation_sessions`, so there is no claim for the strip to read. Not compared screen by screen: command palette, quick access editor, tour steps, sidebar mode, announcement bars.
