# Parity evidence: admin console and app shell

WaDesk 1.7.0 vs this working tree (not committed). Scope so far: the platform-console rail, WD-ASHELL-003 (layout), 004 (grouped
navigation with live counts), 005 (collapse, group toggles, phone drawer) and the console part of 019 (the Ctrl/Cmd+K search). The customer shell, header controls, settings hub
and the rest of the domain are not built yet, and are not covered here.

## Evidence

| What                                              | Where                                                                                      | Result                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Navigation logic and count formatting (unit)      | `apps/web/src/features/admin-console-shell/*.test.ts`                                      | 91 tests pass (menu layout and coverage, search, nav, sidebar)                                       |
| Rail and search in a real browser (our app alone) | `apps/web/e2e/admin-console-shell/shell.spec.ts`, `pnpm --filter @crm/web test:e2e`        | 29 of 30 pass; the gated-admin test needs a super admin without two-factor, and the local one has it |
| Twin run, same scenarios on WaDesk and on ours    | `apps/web/e2e/admin-console-shell/parity/WD-ASHELL-005.twin.mjs`, depth quick, 3 scenarios | PASS before the menu redesign. **Not re-run since**: the reference was not running; see below        |
| Typecheck, lint                                   | `pnpm --filter @crm/web typecheck lint`                                                    | clean                                                                                                |

## Rows (twin run)

| #   | Criterion / UX item                                                           | WaDesk observed                             | Ours observed                                          | Result |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------ | ------ |
| 1   | A guest opening the console is sent to a sign-in page, and sees no console UI | redirected; no console toggle on the page   | redirected; no console toggle on the page              | same   |
| 2   | The rail collapses to icons, remembers it in a cookie, survives a reload      | collapses to about 76 px; cookie set; stays | collapses to 64 px; cookie set; stays; server-rendered | same   |
| 3   | Expanding again restores the full width                                       | restores                                    | restores                                               | same   |
| 4   | On a phone the rail is off-screen and its collapse button is not on screen    | off-canvas at x = -260                      | hidden; collapse button not rendered                   | same   |
| 5   | The page does not scroll sideways on a phone                                  | no overflow                                 | no overflow                                            | same   |

## Intended differences

| #   | Area                    | WaDesk                                                                                                                                 | Here                                                                                                                                                                                                    | Why                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Count format            | Inventory said 12,500 reads `12.5k`                                                                                                    | Reads `13k`                                                                                                                                                                                             | Verified on the running WaDesk: no decimals from 10,000. The inventory example was wrong and is corrected                                                                                                                                                                                                                                                             |
| 2   | Collapsed width         | about 76 px                                                                                                                            | 64 px                                                                                                                                                                                                   | Design-system spacing step; behaviour is the same                                                                                                                                                                                                                                                                                                                     |
| 3   | Menu contents           | About 40 entries, all fixed in code                                                                                                    | Only pages that exist today; each domain adds its own                                                                                                                                                   | Linking to unbuilt pages would 404; entries arrive through the nav data                                                                                                                                                                                                                                                                                               |
| 4   | Icons                   | Per-item icons                                                                                                                         | An icon per section, Overview and Your account; pages are text only                                                                                                                                     | Per-item icons on 69 rows were the clutter. Uses the shared menu icon set, plus five drawn locally (shield, tag, globe, modules, user)                                                                                                                                                                                                                                |
| 5   | Menu grouping and order | Overview, five dashboards at top level, then Users and access, Billing and plans, Support, Marketing and so on (about 8 groups)        | Nine sections by job: Insights, Plans and pricing, Billing and revenue, Support and website, Channels and messaging, Apps and modules, Access and security, Platform settings, System and localization  | Requested by the project owner (2026-10-04): the rail had 21 headings for 69 pages, two of them both named "System" and seven holding a single page, because each ported domain added its own. Every page keeps its address; `console-layout.test.ts` fails if a page is missing, duplicated or left unplaced, and an unplaced page still shows under its own heading |
| 6   | Long sections           | One flat list per group (Platform settings 17, Billing 12)                                                                             | Small headings inside a section (for example Orders and invoices, Payments, Messaging and wallets)                                                                                                      | Same reason; the headings are not links and add no page                                                                                                                                                                                                                                                                                                               |
| 7   | Collapsed rail          | Icon per entry                                                                                                                         | One icon per section; choosing one opens the rail on that section                                                                                                                                       | 69 near-identical icons cannot be told apart; the cookie, width and phone behaviour are unchanged                                                                                                                                                                                                                                                                     |
| 8   | Scrolling               | The whole rail scrolls                                                                                                                 | Only the menu list scrolls; the brand row and Your account stay in view                                                                                                                                 | Long open sections pushed the account link out of sight                                                                                                                                                                                                                                                                                                               |
| 9   | Page moves              | Billing and plans held Packages, Add-ons, Coupons; Support held Inbox and Contact inbox; AI Dashboard and System Health were top level | Add-ons (billing) and Coupons sit in Plans and pricing; Contact inbox sits with the Support inbox; AI usage and System health are in Insights; AI provider keys and Menu order are in Platform settings | Follows WaDesk grouping where the port had drifted from it, and puts each page where an operator looks for it                                                                                                                                                                                                                                                         |

## WD-ASHELL-019: the console search (Ctrl/Cmd+K)

The WaDesk palette is client-only, with a hard-coded index of 56 entries (mostly customer pages) and hidden keywords per entry. The console version
is the same palette fed by the console menu, as the inventory port note says. Checked against the inventory entry and the reference source
(`resources/js/wadesk.js`), and in our own browser spec; **not** compared side by side on the running reference.

| #   | Behaviour (WD-ASHELL-019)                                              | Ours                                                                                       | Result |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------ |
| 1   | Ctrl/Cmd+K opens it on every page, field focused; the same keys toggle | Same, also on non-Latin keyboard layouts (matches the K key position)                      | same   |
| 2   | Empty field lists the first 8 entries                                  | The first 8 pages of the menu                                                              | same   |
| 3   | A query matches name, description and hidden keywords, at most 12      | Name, section, block, hidden keywords and address words; every word must match; at most 12 | same   |
| 4   | Footer hints: up/down navigate, Enter open, Cmd K toggle               | Same                                                                                       | same   |
| 5   | Escape closes; a click outside closes                                  | Same; on a phone Escape closes only the search, not the menu drawer behind it              | same   |
| 6   | Empty state "No results for ..."                                       | Same wording                                                                               | same   |
| 7   | A keyword finds a page its name does not (WaDesk: "roas")              | "stripe" finds Payment gateways, "smtp" finds Mail, "openai" finds AI provider keys        | same   |

| #   | Area        | WaDesk                                                                                              | Here                                                           | Why                                                                                           |
| --- | ----------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 10  | Index       | 56 customer-app entries plus 6 admin ones, not filtered by role                                     | Every page of the console menu, plus Your account              | The inventory port note: feed it from the menu. The console is where the operator is          |
| 11  | Placeholder | "Search pages, contacts, templates, settings..." although no entity search exists (inventory QUIRK) | "Search pages and settings..."                                 | The promise was false; there is no contact or template search to offer                        |
| 12  | Result row  | A tag chip (page, account, plan, help, system) and a description                                    | The section and block the page sits in                         | The chips do not map onto console pages; the location tells the operator where they are going |
| 13  | Header box  | A decorative "Search admin..." box that does nothing (inventory QUIRK)                              | The same box opens the search; on a phone a search button does | A box that looks like a field and does nothing is a defect; a phone has no keyboard shortcut  |
| 14  | Keywords    | One list per entry                                                                                  | English words per page in `console-keywords.ts`                | Other languages search by the translated name and section, plus the English keywords          |

## Not done yet (honest list)

- **The twin run was not repeated after the redesign and the search.** The WaDesk reference was not running, and the run needs the pinned harness (and a Chromium build Playwright 1.60 expects) installed. A twin run now compares a menu that differs from WaDesk on purpose, so the rows in "Intended differences" above need the domain owner's approval first. The previous stamp does not cover the current files.
- **Console search, not done:** the customer-app index entries, the Logout entry and the profile menu from WD-ASHELL-019 (they belong to the customer shell, not started).
- **Search while two-factor enrolment is pending:** the menu is disabled then, so the search is disabled too. The e2e test for the gated admin could not run here (the local super admin already has two-factor), so that case is covered by the code path only.

- **Counts:** WaDesk shows badges for users, roles, permissions, devices, workspaces, coupons and more. Ours shows only the plan count, because that is the only source behind the operator API today. Cross-tenant counts need a sanctioned platform read (a decision for the kernel steward), so none was added.
- **Header controls (WD-ASHELL-006):** health pill, notification bell, account menu with role and email. The theme and language switchers exist; the rest does not.
- **Toasts (WD-ASHELL-007):** the existing toast supports success and error; the warning variant of WaDesk's inline banner is not added.
- **IP allowlist on the console (WD-ASHELL-002):** already enforced by AUTH's `OperatorGuard` on every operator API call; no separate console check was added.
- **Customer shell, quick access, tour, workspace switcher, settings hub (008 to 047):** not started.
- **Twin run depth:** only `quick`, three custom scenarios. The harness's page probes (accessibility, keyboard, degraded states, performance) were not run on the console because its default login is the staff login, not the operator login. Our own Playwright spec covers keyboard and phone behaviour.
- **Environment:** WaDesk ran from a Windows bind mount in Docker, with cold pages taking several seconds; the twin spec uses long timeouts for it.
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
007: the warning variant is the `@crm/ui` Alert tone; toasts stay success and danger (WaDesk's toast also ignored warning).

Not built, with reasons: 030 impersonation strip (blocked: no impersonation session exists in AUTH or WSP yet), 025 workspace white-label colours in
the shell and 036 logo and favicon upload in the shell (blocked on the branding storage endpoints of platform-settings), 008 admin settings hub KPI strip
(the hub itself is the platform-settings page), 045 data residency toggle (needs the i18n translation settings, blocked on that domain), 042's Sheets key
status and webhook counts (blocked on the integration modules). Not ported on purpose: 034 working hours card (docs-only, static), 047 unrouted
prototype pages (dead code).

## Intended differences added in round 2

| #   | Area                  | WaDesk                                              | Here                                                          | Why                                                                            |
| --- | --------------------- | --------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 5   | Settings tabs         | Nine panes swapped client-side on one page          | Rail of nine; four tabs link to the page that owns them       | Each already has its own route in another domain (inventory port notes agree)   |
| 6   | Themes                | Paper, bright, doodle, dark; two stores that differ | Light and dark; one cookie shared by header and Settings      | The design system ships two themes; removes WaDesk's disagreement (046 quirk)   |
| 7   | Connect-device sheet  | Accepted a message from any window                  | Accepts only this origin and only the sheet's own frame       | Security hardening; behaviour for the real page is unchanged                    |
| 8   | New-message pill      | Polled with a fixed interval                        | Backs off after a 429 or error up to 5 minutes, pauses hidden | Keeps load down on a throttled API; the normal interval is the same 15 seconds  |

Live visual twin comparison was not repeated in round 2 (WaDesk was shared and slow); layout was matched from the Blade views and recorded above.
