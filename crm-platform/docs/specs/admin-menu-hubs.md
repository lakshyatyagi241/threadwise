# Admin menu: hubs with tabs

Status: steps 1 to 3 are in PR #159 (branch `lakshya/admin/menu-hubs`, 2026-10-07); revision 2 (blocks and a left menu) is built on
top of it, uncommitted. All of it is unit-tested and none of it has been run in a browser. Zone: `admin-console-shell` (owner: lakshya). Section 10 lists what changed from this plan while building it.

## Revision 2 (2026-10-07): a left menu instead of a tab bar

After a clickable mockup the owner asked for blocks on Home and a menu on the left once an area is open. This replaces the tab bar
described in 4.3 and everything that depends on it. What changed:

| Earlier in this document                       | Now                                                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Rail with 11 hub entries, tab bar on each page | Home is a grid of 11 blocks and has no left rail on desktop. An open area shows its pages in a left menu        |
| `hub-tabs.tsx`, "More" overflow, `MAX_TABS` 9  | `hub-menu.tsx` (back link, area switcher, grouped pages) and `rail-link.tsx`; `MAX_PAGES` 20 per area           |
| `kind: 'tabs' \| 'index'`, Settings back link  | No `kind`. Settings is an area like the others; its overview page is the first item of its menu                 |
| Small headings only in Settings tiles          | `heads` in the layout: group headings in the menu for Team and security (Roles, Security, Sign-in) and Settings |
| Collapsed rail: one icon per hub               | Unchanged: collapsed, the rail shows one icon per area; expanded inside an area it shows that area's menu       |
| Home: 11 cards with a sentence                 | Home blocks: icon tile, name, one line, and the page count                                                      |

Unchanged: the 11 areas and their pages, every address, the role table, search, the route-coverage test, label fixes, and the
rule that a page belongs to exactly one area. On a phone the drawer shows the areas list on Home and the area menu inside an area.
Away from an area (Your account, the notification page) the rail lists Home and all areas. Pages outside every area (for example
`/admin/update`) show that same list.

Not verified in a browser (see section 10): neither the blocks nor the left menu have been looked at in a running app.

## 1. Why

The operator console rail lists **80 entries in 9 sections**. WaDesk's admin menu lists about 40. Operators cannot tell where a
thing lives, because:

1. The same page list is rendered four times: the rail, the `/admin` landing page (the rail reprinted as cards), the Settings hub
   tiles, and the search palette.
2. Settings is flattened into the rail (19 entries). WaDesk has one "Settings" entry.
3. Related things are scattered: WhatsApp lives in five places, "Add-ons" names two different features, support has three inboxes
   plus a fourth filed under Website, and "Billing" mixes customer money, messaging wallets and Meta reseller income.
4. Some built pages have no menu entry at all (Flow templates, which WaDesk does list, plus the wallet overview and the two
   history-analytics pages).
5. Every operator role (`super_admin`, `support`, `auditor`) sees all 80 entries. Most pages are readable by every role (the
   API guards writes only), so this is a smaller problem than first thought: five pages are closed to some roles (4.6).

Root cause: each feature domain adds its own entries and `console-layout.ts` places them by hand, so the menu grows with the
feature count and nothing caps it.

## 2. Goal and success criteria

An operator who knows what they want to do finds it in two clicks without reading the whole menu.

| Criterion                        | Target                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| Top-level rail entries           | 12 or fewer (today 80)                                                                   |
| Tabs in any one hub              | 9 or fewer; extra and runtime module pages go under a "More" overflow                    |
| Clicks from rail to any page     | 2 at most (hub, then tab); Settings pages: rail, then tile                               |
| A page in two tab bars           | Never (a page belongs to one hub)                                                        |
| Built admin pages without a path | None. Every list-level route is a tab, a Settings tile, or on a named "not in menu" list |
| URLs changed                     | None. Bookmarks, permissions, wiring maps, e2e routes stay valid                         |
| What an operator sees            | Hubs and tabs hidden only where the API closes the whole page to the role (4.6)          |
| Search                           | Still finds every page, now labelled `Hub > Tab`                                         |
| Features lost                    | None. Flow templates returns to the menu                                                 |

## 3. Non-goals

- No page is merged, removed, or changed in behavior. In particular the three support inboxes (Inbox, Team inbox, Platform inbox)
  stay three pages; merging them into one screen is a separate feature.
- No backend, contract, migration or permission change.
- No change to the customer app menu, or to the Menu order feature (it configures the customer top bar and stays where it is).
- No Home KPI dashboard beyond "needs attention" (WaDesk's KPI dashboard belongs to the dashboards domain).

## 4. Design

### 4.1 The new menu

Twelve rail entries. Each is a hub: a landing page plus a tab bar of related pages. Every tab is an existing route.

| #   | Hub                | Tabs (existing page ids)                                                                                                                 |
| --- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Home               | `/admin` (rebuilt, see 4.5)                                                                                                              |
| 2   | Reports            | financial, premium, plan-analytics, platform-analytics, ai-dashboard, system-health                                                      |
| 3   | Workspaces & plans | workspaces, plans, addon-packs, coupons, plan-settings, pricing-faqs                                                                     |
| 4   | Billing            | billing-history, order-history, invoices, payment-gateways, checkout-settings                                                            |
| 5   | Messaging billing  | wallet overview, wallet-pricing, wallet-margins, wallet-packages, wallet-logs, bsp-income, bsp-credit                                    |
| 6   | Support            | support-inbox, support-team, support-platform-inbox, support-agents, support-sla, support-playbooks, support-reports, cms-contact        |
| 7   | Website            | cms-frontend, cms-blog, cms-legal, cms-announcements                                                                                     |
| 8   | WhatsApp           | wap-providers, wap-switch, node-bridge, webhook-forwarding, settings-whatsapp (WABA), settings-catalog                                   |
| 9   | Apps               | market-catalogue, market-categories, market-requests, market-usage, extensions, flow-templates (new), then active module pages in "More" |
| 10  | Team & security    | roles, permissions, staff-roles, security, security-events, registration, social-login, auth-pages                                       |
| 11  | Settings           | index hub: one rail entry, the existing hub tiles (4.4)                                                                                  |
| 12  | System             | system (Updater), i18n-languages, currencies, i18n-providers, i18n-usage                                                                 |

Names that clash today are fixed in this change (the keys live in `admin-console-shell.nav`, en and ar):

- "Add-ons (billing)" stays in Plans & pricing as **Add-on packs**; "Add-ons (code)" becomes **Extensions**.
- "Analytics" in Settings (tracking code) is labelled **Tracking code** inside the Settings hub; "Analytics" stays on Reports.
- "Billing settings" (checkout) and "Pricing settings" (plans) keep their pages but get distinct labels: **Checkout settings** and **Plan pricing settings**.
- The sign-in pages are grouped under Team & security even though their URLs sit under `/admin/settings/`.

### 4.2 Data model (replaces `console-layout.ts` sections)

`OPERATOR_NAV` stays the registry of pages (each domain still contributes its own `operator-nav.ts` unchanged, so no other
domain's files are edited). Only placement changes. `console-layout.ts` becomes:

```ts
interface ConsoleHub {
  id: string; // key under admin-console-shell.nav.hubs.<id>
  icon: string;
  kind: 'tabs' | 'index'; // 'index' = Settings: one entry, tiles list the pages
  tabs: readonly string[]; // operator-nav item ids, in order; first visible tab is the landing page
}
```

Rules, enforced by tests:

1. Every operator-nav item is in exactly one hub, or on the explicit `NOT_IN_MENU` list with a reason (4.7).
2. At most 12 hubs. At most 9 tabs per `tabs` hub (module pages are exempt, they overflow into "More").
3. A `tabs` hub has at least 2 tabs (a single page is a rail entry only if it is Home or Settings).
4. An item missing from the layout is never lost: it is appended under a hub named "Other" (kept from today's safety net) and a
   test fails so the placement gets decided.

The rail entry's `href` is the first tab the operator's role can open. Flow templates is added in the shell zone
(`ASHELL_ITEMS` in `console-nav.ts`) so the flow-builder domain's files stay untouched.

### 4.3 Tab bar (new `hub-tabs.tsx` in the shell zone)

Why not `@crm/ui` `Tabs`: it swaps panels in client state and renders only the active panel. Hub tabs must be real links to the
existing routes. So the shell gets a link-based bar:

- Rendered by `ConsoleShell` above `{children}` whenever the current path belongs to a `tabs` hub. **No existing page file is
  edited**, which is what keeps this change inside one zone.
- `<nav aria-label="{hub}">` of `<Link>`s, `aria-current="page"` on the active one; active tab found by longest-prefix match
  (reuses `activeLeafId`), so `/admin/security/events` does not also light up `/admin/security`.
- Keeps today's per-page extras: live count badges (`badgeKey`) and status badges (`statusBadge`, "Not supported" on Node bridge).
- Horizontal scroll on narrow screens; tabs past the visible width, and runtime module pages, collapse into a **More** menu
  (arrow keys, Escape to close).
- Detail and create pages (`/admin/roles/new`, `/admin/marketplace/[ref]`) keep the parent tab active.

### 4.4 Settings hub

Settings stays a single rail entry. Its page already shows one tile per settings page plus cards linking out
(`EXTERNAL_CARDS`). Changes:

- Pages inside Settings show a "Back to Settings" link to the hub instead of a tab bar (17 tabs would be the problem we are
  removing).
- Tiles for pages that moved to another hub (WhatsApp WABA, Catalog) remain as shortcuts, labelled with their hub.
- Not done: the AI keys card still points at the legacy `/admin/ai-keys` address, which redirects to `/admin/api-keys`. Fixing it
  is a one-line edit in another domain's `fields.ts`, so it is left to that domain's owner.

### 4.5 Home (`/admin`)

Today it is the rail as cards. It becomes a short "what needs attention" page, built only from data the operator API already
returns. Two sources are confirmed to exist: the header's health pill (stuck jobs, database down) and the admin notification feed
(signups, payments, tickets, contact messages, new workspaces). Other candidates, such as pending marketplace requests, are
checked against the API when step 3 is planned and left out if no endpoint exists:

- Attention list: stuck jobs or a down database, unread admin notifications, and any further confirmed source.
- One line per hub (12 cards, a sentence each) as the map, replacing the 80 links.

Any attention item whose source does not exist yet is left out and recorded in the backlog; none is faked.

### 4.6 Role-aware menu

The session carries only the role (`super_admin`, `support`, `auditor`), not permission keys. Checking the API showed the role
guards are mostly on write routes (`@OperatorRoles('super_admin')` on a POST or PUT), and the reads behind each page are open to
all three roles. Hiding a page the role can read would be a regression, so the menu hides only pages whose controller carries the
guard on the whole class:

- plan analytics, financial, premium: super admin only;
- AI keys and webhook forwarding: super admin only;
- platform analytics: super admin and auditor, not support.

The table is `console-access.ts`, in the same style and with the same caveat as `operator-role.ts`: the server stays the
authority, the table only decides what the menu offers. A hub with no visible page disappears; the rail entry points at the first
visible page. Pages gated by finer permission keys (`platform.market.*`, `platform.whatsapp_providers.*`, `platform.role.manage`)
still show their "no access" page for a role that has the entry but lacks the key; closing that gap needs permission keys in the
session and is out of scope.

### 4.7 Search palette

`buildSearchIndex` keeps indexing every page and now sets `section = hub label`, `caption = ` the tab group. Hidden keywords
(`console-keywords.ts`) are keyed by item id and carry over unchanged. Results respect the role filter.

### 4.8 What stays reachable but not in the menu

An explicit `NOT_IN_MENU` list with a reason each, checked by a route-coverage test that scans `app/(admin)/**/page.tsx`:

- create and detail pages (`new`, `[id]`, `[ref]`, `[slug]`) which open from their list page;
- legacy redirects (`/admin/ai-keys`, `/admin/bsp/rate-cards`, `/admin/update`);
- `/admin/login`, `/admin/account/security`, `/admin/notifications` (bell and account menu own these).

Anything else without a tab or tile fails the test. This is the permanent fix for the "built but unreachable" problem.

## 5. Code touched

Shell zone only (`apps/web/src/features/admin-console-shell/`):
`console-layout.ts` (hubs), `console-nav.ts` (flat hub entries, role filter, `ASHELL_ITEMS` gains Flow templates),
`console-shell.tsx` (flat rail, mounts tab bar), `hub-tabs.tsx` (new), `console-search.ts`, `console-palette.tsx`,
`console-keywords.ts` (add Flow templates and a few hub words), the `/admin` page,
`messages/{en,ar}/admin-console-shell.json`.

One cross-zone touch: the Settings hub card fix in `platform-settings-branding-storage/fields.ts` (4.4), which is a seam edit
to be agreed with that domain's owner. Every other domain's `operator-nav.ts` is left as is.

Helpers that go away with collapsible sections: `initiallyOpenGroups` and per-group open state. The collapsed (icon-only) rail
keeps working and gets simpler with 12 flat icons.

## 6. Tests and verification

- Unit: hub placement rules (4.2), role filtering, longest-prefix active tab with detail pages, overflow split, search labels.
- Route-coverage test (4.8).
- Update `console-nav.test.ts`, `console-layout.test.ts`, `console-search.test.ts`, `messages.test.ts` (en and ar key parity).
- Update `e2e/admin-console-shell/shell.spec.ts` for the flat rail and tab bar; add a case per role (`super_admin`, `support`,
  `auditor`) asserting the visible hubs.
- Playwright twin run against the reference: the menu layout differs on purpose, so the run records each difference as
  `intended` in `docs/wadesk-port/parity/admin-console-shell.md` with the reason (menu too long and duplicated). Behavior of every
  page is unchanged and must read `same`.
- Help guide for the console menu via `help-docs-sync`, same change.
- `bash .claude/skills/pre-pr/scripts/gate.sh` before the PR.

## 7. Rollout in four steps

Each step ships on its own and leaves the console working.

1. **Structure.** Hub data, flat rail, tab bar, search labels, route-coverage test, Flow templates entry. This is the change
   operators will notice.
2. **Role-aware menu.** `PAGE_ROLES` and hiding.
3. **Home.** Attention list and hub map.
4. **Polish.** Help guide, parity doc rows, e2e, and the label fixes if they were not already in step 1.

No feature flag: the change is presentation only and `git revert` of step 1 restores the old rail.

## 8. Risks

| Risk                                                              | Mitigation                                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Some pages already draw their own tab row, giving two rows        | Step 1 reviews each hub in the browser; a page's own tabs are kept, and the hub bar stays on top |
| Operators used to the old rail look for a page that moved         | Search finds the old name (keywords kept); Home shows the 12-hub map                             |
| `PAGE_ROLES` drifts from the API guards                           | Same caveat and pattern as `operator-role.ts`; the server still enforces access                  |
| Runtime module pages make a long "More" list                      | Module pages are alphabetical inside "More" and searchable                                       |
| Moving WABA settings and Catalog out of Settings surprises people | Their Settings tiles remain as labelled shortcuts                                                |

## 9. Open questions

1. WaDesk lists Users, Workspaces and Devices in its admin menu, and our routes have none of them. I have not checked whether they
   are planned or deliberately omitted; if they are built later they join Team & security (Users) and a Workspaces hub, which would
   bring the rail to 13. That needs either raising the cap to 13 or folding Workspaces into Plans & pricing. Decide when they land.
2. Permission keys in the operator session would let the menu hide pages by finer permission, not only by role. Worth a follow-up
   if the "no access" pages keep confusing support staff.

## 10. What changed while building it (2026-10-07)

- `/admin/bsp/dashboard` renders the same page as `/admin/bsp` (WaDesk's address for Message income). It is on the `NOT_IN_MENU`
  list, not a tab. This closes the first open question of the draft.
- The role-aware menu is much narrower than drafted (4.6): five pages, not a general filter.
- The Home attention list uses only the two confirmed sources (health and the notification feed); no marketplace-requests item.
- Tab bar: pages beyond nine, and module pages added at run time, sit under a "More" menu built on a native disclosure element.
- Settings pages get a back link, not a breadcrumb.
- Label clashes are fixed by overrides in the shell's own nav file, so no other domain's message file changed.
- Rail entries are 11 hubs plus Home (12), as designed. Tab counts: Reports 6, Plans & pricing 6, Billing 5, Messaging billing 8,
  Support 9, Website 5, WhatsApp 7, Apps 6, Team & security 8, System 5; Settings lists 17 pages as tiles.
- Not verified in a browser: the session that built this could not start the web app, so neither the tab bar's look nor the
  rewritten e2e spec has been run. See the parity doc.
