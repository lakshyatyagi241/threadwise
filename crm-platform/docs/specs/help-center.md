# Spec: Help center (plan-aware documentation, tooltips, auto-docs)

|             |                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**  | Draft for owner review                                                                                                                                                                                                                                                                                                                                                                                    |
| **Author**  | Drafted with Claude Code from the owner's brief (2026-10-04) and a read-only survey of the repo                                                                                                                                                                                                                                                                                                           |
| **Related** | `apps/web/src/features/_registry/` (nav, settings, planned, gate resolution), `apps/web/src/components/shell/` (rail, top bar, user menu), `packages/contracts/src/plans-subscriptions-trials/catalogue.ts` (plan feature keys), `apps/api/src/modules/addons-extension-registry/module-registry.service.ts` (dormant features), `docs/wadesk-port/ownership.json`, `.claude/skills/wadesk-port-feature/` |

---

## 1. Problem and intent

The product has dozens of screens and plan-gated features and no in-app explanation of any of them. Three people build in
parallel, so documentation written "later" will not exist.

The owner wants:

1. A **Help center** with one document per feature, reachable from the main menu (an icon just above Settings).
2. Every document **belongs to a plan feature or module**: when the plan does not include the feature, or the module is
   disabled, the document is gone for that workspace (not locked, not teased).
3. **Tooltips** ("?") on pages and sections that explain in a line and link to the matching document.
4. A **standing rule**: whoever builds anything writes its document in the same change, and when the owner pulls the team's
   work, any feature that arrived without a document is listed and drafted automatically. (Saved as the owner's feedback
   memory `feedback_docs_for_every_build_and_pull`.)

**Success looks like:** open a workspace on a plan without Deals, and no Deals document, search hit or tooltip exists for it;
upgrade the plan and they appear on the next page load. A teammate cannot merge a new screen without a document or an explicit
pending entry. After a pull, the owner gets a list of undocumented features and drafts for them.

## 2. Scope

**In (v1):** the workspace app (`apps/web`, the `(app)` shell). Everything in section 4 to 8. A first content pass covering
every screen that is built today.

**Out of (v1):**

| Not in scope                                                                                      | Why                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The operator console (`(admin)` shell)                                                            | A different audience and shell. Docs carry an `audience` field (`workspace` default, `operator` reserved) so it can be added without reshaping anything.                                                                                                    |
| WaDesk's **Guidebook** (operator-authored articles in a `guidebook_articles` table, `/guidebook`) | It is a separate WaDesk feature on the port list (rule 1: nothing merged, renamed or replaced). The `guidebook` and `support` entries stay in the user menu as planned. Help center is additional; a later change may surface Guidebook articles inside it. |
| Per-workspace or third-party (Marketplace mini app) documentation                                 | Needs authoring UI and review; v1 docs are repo content.                                                                                                                                                                                                    |
| Docs stored in the database / edited in the browser                                               | Repo files are reviewed in PRs, versioned with the feature, and are what Claude drafts.                                                                                                                                                                     |
| Translating bodies into Arabic                                                                    | Supported by the format (section 4.1); chrome strings are translated now, bodies fall back to English.                                                                                                                                                      |

## 3. Terms

- **Doc**: one markdown file with frontmatter, in `features/<domain>/help/<slug>.md`.
- **Documents**: the nav item(s) or Settings tile(s) a doc explains. A doc that documents a screen is only shown when that
  screen is built (not a "coming soon" entry).
- **Gates**: the same three gates the menu uses (`permission`, `planFeature`, `channel`; `NavGates` in `_registry/types.ts`).
- **Visible doc**: a doc that passes its effective gates and whose screen is built, for this person in this workspace.

## 4. Design

### 4.1 Content: markdown in each domain

```
features/<domain>/help/<slug>.md        English body (required)
features/<domain>/help/<slug>.ar.md     optional Arabic version with its own title, summary and body (same id); absent = English is shown, with a "shown in English" note
```

Frontmatter (the `#` notes in the sample are annotations; real files have no inline comments, and a value may contain `:` and `#`). The generator validates syntax, so a bad file fails `pnpm dev`/`build`/`lint`/`typecheck`/`test` and never reaches runtime:

```yaml
---
id: contacts-overview          # unique across the app, kebab-case; used in /help/<id> and <HelpTip doc="...">
title: Contacts
summary: Your customer list: add people, import them, group and search them.   # <= 160 chars; tooltip and search text
area: audience                 # a menu group id (overview, inbox, audience, sales, campaigns, automation, store, apps),
                               # or settings | account | getting-started
order: 10
documents: [nav:contacts]      # nav:<id> and/or tile:<id>; empty only for guide-level docs (getting-started, billing basics)
gates:                         # optional, in addition to what the documented screen already requires
  planFeature: sales_pipeline
keywords: [customers, leads, people]
audience: workspace            # default
---
```

The body is a **restricted markdown subset** parsed by our own pure function (no new dependency, no raw HTML, so nothing to
sanitise): `##`/`###` headings (anchors are the slugified heading), paragraphs, `-` and `1.` lists, `> ` callouts, `**bold**`,
`` `code` ``, and links. Links are app-relative paths or `help:<doc-id>` (a link to a doc the person cannot see degrades to
plain text, so a gated doc is never revealed by a neighbour). External URLs are not allowed.

The recommended shape of a doc, enforced by the skill (section 7), not the parser: what it is for, how to use it step by step,
what each setting does, limits and plan requirements, and "if something looks wrong". (The skill in section 6 enforces it.)

**Effective gates** = the documented screen's own gates (from its nav item or tile) plus the doc's `gates`. Authors do not
repeat what the screen already declares.

### 4.2 Registry (generated, like nav and settings)

`apps/web/scripts/gen-registry.mjs` gains a third registry. It reads every `features/*/help/*.md`, compiles frontmatter and
body, and writes one gitignored file, `features/_registry/help.generated.ts`: every doc with its parsed body as data. Generated
TS rather than runtime `fs` reads so the Docker standalone build needs no file tracing. There is no separate index file: the
client index (id, title, summary, area, keywords, routes, headings, no bodies) is built per request by `toIndex`, because it
depends on the person's locale and visible docs.

Parsing lives in `apps/web/scripts/help-compile.mjs` as pure exported functions (typed by `help-compile.d.mts`) so vitest can test them. It sits in `scripts/` because ESLint's typed project service cannot parse a `.mjs` inside `src`.

The generator checks syntax and cross-doc rules and exits non-zero on error: unique `id`; `summary` length; valid `area`; the
restricted-markdown rules; `[text](help:id)` targets exist; every translation file has an English twin with the same id.
Semantic checks that need the nav and tile registries run in a vitest test (`registry.test.ts`, part of `pnpm test`): `documents`
entries resolve to a declared nav item or tile (not a planned one); `planFeature` is a real key (`isPlanFeatureKey`); the area
matches the documented screen's menu group.

### 4.3 Gating: how docs "go away"

`resolveHelp(docs, caps, builtIds)` in `features/help-center/resolve.ts` (pure, unit-tested) returns the visible docs:

1. If the doc has `documents`, at least one target must be available: a resolved nav item or Settings tile that is **not**
   `comingSoon` and not `locked`. Permission and channel gates on the screen already removed it from the resolved lists, and a
   missing plan feature on the screen marks it `locked`, so the screen's own gates apply with no copying.
2. `permission` and `channel` gates remove the doc, as for the menu.
3. A missing `planFeature` **removes** the doc. This is the one deliberate difference from the menu, which keeps the item and
   shows an upgrade lock. Help must not advertise what the plan lacks.
4. Unknown capabilities (`null`, e.g. the entitlement lookup timed out) remove nothing, the same fail-open rule the menu uses.

**Modules.** Removing or disabling a module already makes its plan flags dormant (`isDormantFeature`, WD-ADD-015), and
`/v2/billing/entitlements` omits them. So a module's docs gate on the module's plan feature key, and they vanish with the
module with no new backend. A module that contributes screens but no plan flag cannot be hidden by module state in v1 (there
is no workspace-readable list of enabled modules); the coverage test (section 6) fails a module-owned doc that declares neither
a `documents` target nor a `planFeature`, so the gap is visible rather than silent.

**Where it runs.** In the server component `(app)/layout.tsx`, next to the existing `resolveNav`, and again in each `/help`
route handler. Bodies are only ever rendered by server components for visible docs; `/help/<id>` for a hidden doc returns 404;
search and the tooltip index are built from the visible set. A hidden doc's text never reaches the browser.

### 4.4 Screens

New domain `help-center` (`features/help-center/`, `app/(app)/(help-center)/help/`):

| Route        | What                                                                                                                                                                                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/help`      | Header, search box, then visible docs grouped by `area` (same group names as the menu). Search filters title, summary, keywords and headings client-side over the index. Empty state when nothing matches; a workspace with no visible docs sees a single "Getting started" doc (always visible, no gates). |
| `/help/[id]` | The doc: title, summary, rendered body, "On this page" list, related docs (same area), and an "Open this screen" button when the person may open it. Deep links to `#heading` work; focus moves to the heading. Not-visible id: 404.                                                                        |

Both are server components; the search box is the only client island. Layout uses logical properties (RTL), a heading outline,
and no horizontal scroll at phone width.

### 4.5 The Help icon in the menu

`features/help-center/nav.ts` declares `{ id: 'help-center', group: 'settings', order: -10, icon: 'help', labelKey: 'shell.help' }`.
The rail already pins every `settings`-group item under the scrolling list, ordered, so Help renders directly above Settings
in both the slim rail and the mobile drawer. The one change to `nav-rail.tsx` is the label of that pinned `<nav>` landmark, from
"Settings" to "Help and settings" (`shell.pinned`), because it now holds both. `types.ts`'s comment on the `settings` group is
updated to say "pinned to the bottom" (it no longer holds only Settings). The user menu's Support and Guidebook block is
untouched. The `help` icon exists in `nav-icons.tsx`. Active state: `/help` and `/help/*`.

### 4.6 Tooltips

There is no shared tooltip primitive today (the rail draws its own). Add `HelpTip` in `features/help-center/help-tip.tsx` on the
existing `@crm/ui` popover:

```tsx
<HelpTip doc="contacts-import" anchor="duplicates" /> // section-level
```

- Renders **nothing** when `doc` is not in the visible index, so tips disappear with their doc.
- Without `anchor`: the popover shows the doc's `summary` (already on the client, no request).
- With `anchor`: shows the first paragraph under that heading, fetched on first open through a server action that re-checks
  gates; the index stays small.
- Always ends with a "Read more" link to `/help/<doc>#<anchor>`. Trigger is a real `<button>` with an accessible name, opens on
  click/Enter/Space (hover is a bonus, never the only way), Esc closes, focus returns to the trigger, works in RTL.
- A tip text lives only in the doc, so it cannot drift from it.

**Page-level tip, automatic.** The shell's top bar shows one "?" per page, resolved from the pathname to the visible doc whose
documented screen's href is the longest prefix match (a doc may add explicit `routes:`). That covers every documented screen
without editing any other domain's page files. Section-level `<HelpTip>`s are added by domain owners, inside their own domain's files, where a control is not obvious; the
`help-docs-sync` skill (section 6) does so for screens in the domain it is run for. The first content pass adds none (it would
edit other people's files); the page-level tip covers every documented screen.

**Client plumbing.** `(app)/layout.tsx` passes the visible index to a small `HelpProvider` (context). `HelpTip` and the top-bar
tip read from it.

### 4.7 Shell and shared-file changes (all additive)

| File                                                           | Change                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `app/(app)/layout.tsx`                                         | resolve visible docs; wrap in `HelpProvider`                               |
| `components/shell/top-bar.tsx`, `app-shell.tsx`                | a `pageHelp` slot rendering the page-level tip beside the settings gear    |
| `components/shell/nav-rail.tsx`, `messages/{en,ar}/shell.json` | landmark label `shell.pinned`                                              |
| `_registry/types.ts`                                           | comment only                                                               |
| `scripts/gen-registry.mjs`                                     | third registry                                                             |
| `messages/{en,ar}/help-center.json`, `shell.json`              | chrome strings (`shell.help` label, tooltip/search/empty copy)             |
| `docs/wadesk-port/ownership.json`                              | new `help-center` zone; `features/*/help/**` becomes a shared seam (see 8) |

## 5. Data and API

No database table, no migration, no new endpoint, no new permission. Plan state comes from the existing
`GET /v2/billing/entitlements`; person state from the existing session. The Help center is read-only content, so none of the
RLS / outbox / contracts rules apply.

## 6. Keeping docs complete (the standing rule, made mechanical)

**Coverage unit** = every nav item and Settings tile that is built (declared in `features/*/nav.ts` or `settings.ts`, not in a
`planned` file) plus every plan feature key in `PLAN_FEATURE_KEYS`. A screen is covered when some doc lists it in `documents`; a plan feature key is
covered when at least one doc declares it in `gates.planFeature` or inherits it from a documented screen.

1. **`help-coverage.test.ts`** (vitest, runs inside `pnpm test`, therefore inside `gate.sh` and CI) fails when a unit has no
   doc, unless it is listed in `features/help-center/pending.json`. A pending entry needs `unit`, `owner` and `reason`; the file
   can be edited but every line is reviewable in the PR, so "no doc" is always a visible, owned choice. It also fails on a pending
   entry that has since been documented (the list can only shrink honestly), and on a doc whose gate key is unknown.
2. **`bash .claude/skills/help-docs-sync/scripts/pending.sh`** runs the same logic through a vitest file gated by
   `HELP_WRITE_PENDING=1` (no `package.json` change) and writes `docs/help-pending.md` (generated, gitignored): undocumented
   units grouped by domain and owner. It never fails.
3. **`.husky/post-merge`** runs that command after every pull or merge and prints one line (`N features have no help doc:
docs/help-pending.md`). It never blocks or fails the pull.
4. **Claude, on the owner's pull.** A `SessionStart` hook in `.claude/settings.json` reads the count from the first line of
   `docs/help-pending.md` that the post-merge hook and the gate keep fresh (instant, no test run) and, when it is above 0, injects "N features have no help doc; run `help-docs-sync`". The `CLAUDE.md` rule says the session drafts them
   without being asked.
5. **Claude, on every build.** New skill `.claude/skills/help-docs-sync/`: for each unit (or the unit just built) read its
   inventory entry and wiring map and the screen code, write `features/<domain>/help/<slug>.md` in our own words, add
   section-level `<HelpTip>` where a screen has a non-obvious control, regenerate, run the coverage test, remove the pending
   entry. It is added as a step of `wadesk-port-feature` (before parity) and to `CLAUDE.md`'s "after you build or change any
   feature" rules, next to the parity rule.

The skill's writing rules: plain language for a workspace admin, no WaDesk text pasted (the port skill forbids copying its
copy-deck; the docs describe **our** screens), state plan requirements and limits explicitly, and describe only behaviour that
exists in the build.

## 7. First content pass

Written once, now, by parallel sub-agents partitioned by domain, each reading the domain's wiring map, inventory entry and the
built screens, and each following `help-docs-sync`:

- one overview doc per built nav item or tile, plus the few guide docs (`getting-started`, plans and billing basics, roles and
  permissions basics) where one idea spans screens;
- planned (not built) screens get **no** doc, so nothing describes a button that does not exist;
- whatever cannot honestly be documented yet (a screen mid-port) goes to `pending.json` with its owner.

I review a sample of each domain's output against the running screens before it is called done.

## 8. Ownership and process

- `features/help-center/` and `app/(app)/(help-center)/` are a new zone owned by the repo owner (Lakshya per the branch; the
  owner confirms).
- `features/<domain>/help/` lives inside each domain's zone, so each developer documents their own domain afterwards. The first
  pass writes **new files only** into every domain's `help/` folder; no existing file is edited. The help-center zone and the
  `features/*/help/**` seam are recorded in `SEAMS` of `wadesk-ownership-guard/scripts/gen_ownership.py` (which regenerates
  `ownership.json`); that seam policy needs the other two developers' approval.
- The shell and registry files in 4.7 are in the admin-console-shell zone, where the owner has uncommitted work. Edits are
  additive and made on top of the working tree; nothing is reverted or committed.
- Nothing is committed or pushed unless the owner asks (repo `CLAUDE.md`).

## 9. Testing

| Layer                                         | What                                                                                                                                                                                                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (`help-compile`)                         | frontmatter and body parsing, every validation rule, heading anchors, restricted-markdown rejections (raw HTML, external link, bad `help:` link)                                                                                                                      |
| Unit (`resolve`)                              | plan feature on/off, dormant module feature absent from entitlements, permission, channel, unbuilt screen, caps unknown, effective-gate union, `help:` link degradation                                                                                               |
| Unit (`coverage`)                             | undocumented unit fails, pending entry passes, stale pending entry fails, unknown gate key fails                                                                                                                                                                      |
| Unit (messages)                               | `en`/`ar` parity for `help-center.json` (existing messages test pattern)                                                                                                                                                                                              |
| Component                                     | `HelpTip` renders nothing when hidden, summary vs anchored text, keyboard open/close/focus return, RTL placement                                                                                                                                                      |
| E2E (Playwright, `apps/web/e2e/help-center/`) | Help icon sits above Settings (rail and drawer); `/help` lists visible docs and search filters; a doc gated on a plan feature the seeded plan lacks is absent from the list, search and direct URL (404); the page tooltip opens and its link lands on the doc anchor |

**Parity.** The Help center has no WaDesk counterpart (Guidebook is untouched). The `wadesk-playwright-parity` skill is still
run and records "no comparable surface" itself; the Help entry in the rail and the plan-aware docs are recorded as intended
differences in `docs/wadesk-port/parity/help-center.md`. No `skipped --user-approved` stamp is used (the owner did not give that
word).

## 10. Risks and known limits

| Risk                                                           | Handling                                                                                                                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docs describe behaviour that is later changed                  | the skill runs on every build; coverage catches missing docs but not stale ones, so each doc lists the screen it documents and `help-docs-sync` re-reads it when that screen's files change |
| A module with no plan flag cannot vanish with the module (4.3) | flagged by the coverage test; a workspace-readable enabled-modules list is a small follow-up if such modules appear                                                                         |
| Entitlement lookup fails, so gated docs show                   | fail-open on purpose, same as the menu; docs are not sensitive                                                                                                                              |
| Cross-zone first pass                                          | new files only, seam recorded (8)                                                                                                                                                           |
| Bundle size of bodies                                          | bodies are server-only and never in the client index                                                                                                                                        |

## 11. Build order

1. Compiler, generator, validation, and tests (`help-compile`, third registry).
2. `resolve`, provider wiring in `(app)/layout.tsx`.
3. `/help` and `/help/[id]` screens and the doc renderer; menu entry; messages.
4. `HelpTip`, the page-level tip in the top bar.
5. Coverage rules and the pending report, post-merge hook, SessionStart hook, `help-docs-sync` skill, `CLAUDE.md` and
   `wadesk-port-feature` rules, ownership seams.
6. First content pass.
7. The strict coverage test and `pending.json` (introduced here, after the pass, so `pnpm test` is green at every step), with
   what could not be documented honestly listed as pending.
8. End-to-end tests, then verify in the running app (Help icon, a gated doc, tooltip) and run `gate.sh`.

The step-by-step plan is [help-center-plan.md](help-center-plan.md).
